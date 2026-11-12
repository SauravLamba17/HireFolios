import fs from "node:fs/promises";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { db, isUniqueViolation } from "@/db";
import { applications, candidateFiles, candidates, consents, dailyCounters, jobs, locations, stages } from "@/db/schema";
import { searchTextFor } from "@/lib/candidate-search";
import { DOCX, sniffType, storageKey, sha256, uploadRoot, writeFileUnder, type FileType } from "@/lib/files";
import { getCompany } from "@/lib/company";
import { uploadLimits } from "@/lib/config";
import { firstIssue, makeIntakeRequest, type IntakeResult } from "@/lib/intake";
import { getOptionLists } from "@/lib/lists-db";
import { getActiveNotice } from "@/lib/notice-db";
import { todayIST } from "@/lib/ist";
import { publish } from "@/lib/live";
import { lpaToRupees } from "@/lib/money";
import { requireStaffApi } from "@/lib/session";
import { audit } from "@/lib/staff";


const bad = (error: string, status = 400) => Response.json({ error }, { status });

class IntakeError extends Error {}

type Upload = { kind: "photo" | "cv_page" | "cv_upload"; type: FileType; data: Uint8Array; pageNo: number | null };

async function readUpload(v: FormDataEntryValue | null, max: number, allowed: FileType[], what: string): Promise<Omit<Upload, "kind" | "pageNo"> | string | null> {
  if (!(v instanceof Blob) || v.size === 0) return null;
  if (v.size > max) return `${what} is larger than ${Math.round(max / 1024 / 1024)} MB.`;
  const data = new Uint8Array(await v.arrayBuffer());
  const type = sniffType(data);
  if (!type || !allowed.includes(type)) return `${what} must be ${allowed.map((t) => t.split("/")[1].toUpperCase()).join(" or ")}.`;
  return { type, data };
}

/** Builds the response for a saved intake, so a retried request gets exactly the same answer. */
async function resultFor(tenantId: string, clientRequestId: string): Promise<IntakeResult | null> {
  const [row] = await db
    .select({
      applicationId: applications.id,
      candidateId: applications.candidateId,
      token: applications.token,
      tokenDate: applications.tokenDate,
      createdAt: applications.createdAt,
      fullName: candidates.fullName,
      email: candidates.email,
      dateOfBirth: candidates.dateOfBirth,
      jobTitle: jobs.title,
    })
    .from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.tenantId, tenantId), eq(applications.clientRequestId, clientRequestId)));
  if (!row) return null;

  const earlier = await db.$count(
    applications,
    and(eq(applications.tenantId, tenantId), eq(applications.candidateId, row.candidateId), lt(applications.createdAt, row.createdAt)),
  );
  // Possible duplicates under another mobile: same email, or a similar name with the same date of birth.
  const dupes = await db.execute<{ id: string; full_name: string; mobile: string; same_email: boolean }>(sql`
    select id, full_name, mobile, (${row.email}::text is not null and email = ${row.email}) as same_email
    from candidates
    where tenant_id = ${tenantId} and id <> ${row.candidateId}
      and ((${row.email}::text is not null and email = ${row.email})
        or (date_of_birth = ${row.dateOfBirth}::date and similarity(full_name, ${row.fullName}) >= 0.5))
    order by similarity(full_name, ${row.fullName}) desc
    limit 5`);

  return {
    token: row.token,
    tokenDate: row.tokenDate,
    applicationId: row.applicationId,
    candidateId: row.candidateId,
    fullName: row.fullName,
    jobTitle: row.jobTitle,
    returning: earlier > 0,
    duplicates: dupes.map((d) => ({
      id: d.id,
      fullName: d.full_name,
      mobileLast4: d.mobile.slice(-4),
      reason: d.same_email ? "same email" : "similar name and same date of birth",
    })),
  };
}

export async function POST(req: Request) {
  const { staff, error } = await requireStaffApi(req, "intake");
  if (error) return error;
  const root = uploadRoot();
  if (!root) return bad("File storage is not set up on the server (UPLOAD_DIR). Ask your admin.", 500);
  const L = uploadLimits();
  const maxRequest = L.maxPhotoBytes + L.maxCvPages * L.maxPageBytes + L.maxCvFiles * L.maxUploadBytes + 256 * 1024;
  if (Number(req.headers.get("content-length") ?? 0) > maxRequest) return bad("The upload is too large.", 413);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad("Could not read the upload. Try again.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("data") ?? ""));
  } catch {
    return bad("Missing candidate details.");
  }
  // List fields are checked against this tenant's active list items (Settings → Lists).
  const [lists, notice, company] = await Promise.all([getOptionLists(staff.tenantId), getActiveNotice(staff.tenantId), getCompany(staff.tenantId)]);
  const parsed = makeIntakeRequest(lists).safeParse(raw);
  if (!parsed.success) return bad(firstIssue(parsed.error));
  const { clientRequestId, mobile, details: d, consent } = parsed.data;
  if (consent.noticeVersion !== notice.version) return bad("The privacy notice changed. Show it to the candidate again.");

  // A retry of a save that already went through (the browser lost the reply): same answer, nothing new.
  const done = await resultFor(staff.tenantId, clientRequestId);
  if (done) return Response.json(done);

  const photo = await readUpload(form.get("photo"), L.maxPhotoBytes, ["image/jpeg"], "The photo");
  if (photo === null) return bad("Take the candidate's photo first.");
  if (typeof photo === "string") return bad(photo);
  const uploads: Upload[] = [{ kind: "photo", pageNo: null, ...photo }];

  const pages = form.getAll("cvPage");
  if (pages.length > L.maxCvPages) return bad(`At most ${L.maxCvPages} CV pages.`);
  for (const [i, p] of pages.entries()) {
    const page = await readUpload(p, L.maxPageBytes, ["image/jpeg"], `CV page ${i + 1}`);
    if (typeof page === "string") return bad(page);
    if (page) uploads.push({ kind: "cv_page", pageNo: i + 1, ...page });
  }
  const cvFiles = form.getAll("cvFile");
  if (cvFiles.length > L.maxCvFiles) return bad(`At most ${L.maxCvFiles} CV files.`);
  for (const [i, f] of cvFiles.entries()) {
    const file = await readUpload(f, L.maxUploadBytes, ["application/pdf", DOCX, "image/jpeg", "image/png", "image/webp"], cvFiles.length > 1 ? `CV file ${i + 1}` : "The CV file");
    if (typeof file === "string") return bad(file);
    if (file) uploads.push({ kind: "cv_upload", pageNo: null, ...file });
  }

  const written: string[] = [];
  try {
    await db.transaction(async (tx) => {
      const tenant = staff.tenantId;
      const [job] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.id, d.jobId), eq(jobs.tenantId, tenant), eq(jobs.status, "open")));
      if (!job) throw new IntakeError("That position is not open any more. Choose another.");
      const [stage] = await tx
        .select({ id: stages.id })
        .from(stages)
        .where(and(eq(stages.tenantId, tenant), eq(stages.active, true)))
        .orderBy(asc(stages.position))
        .limit(1);
      const [location] = await tx
        .select({ id: locations.id })
        .from(locations)
        .where(and(eq(locations.tenantId, tenant), eq(locations.active, true)))
        .orderBy(asc(locations.createdAt))
        .limit(1);
      if (!stage || !location) throw new IntakeError("Intake is not set up yet (no stage or location). Ask your admin.");

      const profile = {
        fullName: d.fullName,
        email: d.email,
        dateOfBirth: d.dateOfBirth,
        city: d.city,
        qualification: d.education,
        experienceMonths: d.experienceYears * 12 + d.experienceMonths,
        currentCtc: d.currentCtcLpa === null ? null : lpaToRupees(d.currentCtcLpa),
        expectedCtc: d.expectedCtcLpa === null ? null : lpaToRupees(d.expectedCtcLpa),
        noticeDays: d.noticeDays,
        languages: d.languages,
        skills: d.skills,
        certifications: d.certifications,
        codingSpecialties: d.codingSpecialties,
        ehrSoftware: d.ehrSoftware,
        nightShiftOk: d.nightShiftOk,
        voiceProcess: d.voiceProcess,
        typingWpm: d.typingWpm,
      };
      const searchText = searchTextFor(profile);
      // Returning candidates (same mobile) get their details updated to what HR confirmed today.
      const [cand] = await tx
        .insert(candidates)
        .values({ tenantId: tenant, mobile, ...profile, searchText })
        .onConflictDoUpdate({ target: [candidates.tenantId, candidates.mobile], set: { ...profile, searchText, updatedAt: new Date() } })
        .returning({ id: candidates.id, inserted: sql<boolean>`xmax = 0` });

      const today = todayIST();
      const [counter] = await tx
        .insert(dailyCounters)
        .values({ tenantId: tenant, counterDate: today, lastValue: 1 })
        .onConflictDoUpdate({ target: [dailyCounters.tenantId, dailyCounters.counterDate], set: { lastValue: sql`${dailyCounters.lastValue} + 1` } })
        .returning({ n: dailyCounters.lastValue });
      const token = `${company.tokenPrefix}-${String(counter.n).padStart(3, "0")}`; // prefix: Settings → Company

      const [app] = await tx
        .insert(applications)
        .values({
          tenantId: tenant,
          candidateId: cand.id,
          jobId: job.id,
          locationId: location.id,
          token,
          tokenDate: today,
          currentStageId: stage.id,
          clientRequestId,
          source: d.source,
          hrNotes: d.hrNotes,
          createdBy: staff.id,
          // Time of registration = when the token was issued (the counter row lock orders parallel
          // intakes), not when the transaction began; the drive queue orders first-round walk-ins by it.
          createdAt: sql`clock_timestamp()`,
        })
        .returning({ id: applications.id });

      // Consent is recorded before any file row (hard rule: consent before camera).
      await tx.insert(consents).values({
        tenantId: tenant,
        candidateId: cand.id,
        applicationId: app.id,
        noticeVersion: notice.version,
        noticeId: notice.id,
        language: consent.language,
        talentPool: consent.talentPool,
        whatsapp: consent.whatsapp,
        recordedBy: staff.id,
      });

      for (const u of uploads) {
        const id = crypto.randomUUID();
        const key = storageKey(tenant, cand.id, id, u.type);
        written.push(await writeFileUnder(root, key, u.data));
        await tx.insert(candidateFiles).values({
          id,
          tenantId: tenant,
          candidateId: cand.id,
          applicationId: app.id,
          kind: u.kind,
          storageKey: key,
          mimeType: u.type,
          sizeBytes: u.data.byteLength,
          pageNo: u.pageNo,
          sha256: sha256(u.data),
        });
      }

      await audit(tx, {
        tenantId: tenant,
        actorUserId: staff.id,
        action: "intake.create",
        entityType: "application",
        entityId: app.id,
        meta: {
          candidateId: cand.id,
          jobId: job.id,
          returning: !cand.inserted,
          cvPages: uploads.filter((u) => u.kind === "cv_page").length,
          cvUpload: uploads.some((u) => u.kind === "cv_upload"),
        },
      });
    });
  } catch (e) {
    await Promise.all(written.map((f) => fs.rm(f, { force: true })));
    if (e instanceof IntakeError) return bad(e.message);
    // Double-tap: the same request was saved by a parallel call a moment ago.
    if (isUniqueViolation(e, "applications_tenant_client_request_uq")) {
      const again = await resultFor(staff.tenantId, clientRequestId);
      if (again) return Response.json(again);
    }
    throw e;
  }

  publish(staff.tenantId); // drive board / lobby counts refresh
  const result = await resultFor(staff.tenantId, clientRequestId);
  return Response.json(result, { status: 201 });
}
