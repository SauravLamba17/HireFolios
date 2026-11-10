// Smoke test against a running server: `npm run smoke` (SMOKE_BASE_URL, default http://localhost:3000).
// Creates two throwaway tenants (so tokens start at A-001), checks intake / lookup / files / search /
// profile end to end, then deletes everything it created, rows and files. Needs DATABASE_URL and UPLOAD_DIR.
import fs from "node:fs";
import path from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pgClient } from "@/db";
import * as s from "@/db/schema";
import { uploadRoot } from "@/lib/files";
import { NOTICE_VERSION } from "@/lib/notice";
import { createStaff } from "@/lib/staff";

const BASE = (process.env.SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const RUN = Date.now().toString(36);
const results: { name: string; ok: boolean; info?: string }[] = [];
const check = (name: string, ok: boolean, info?: unknown) => {
  results.push({ name, ok, info: ok ? undefined : JSON.stringify(info)?.slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  → ${JSON.stringify(info)?.slice(0, 300)}`}`);
};

// Magic bytes are all the server checks; the content does not need to be a viewable picture.
const jpeg = (tag: string) => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from(`smoke-${tag}-${RUN}`)])], { type: "image/jpeg" });
const mobileFor = (n: number) => `6${String(Date.now()).slice(-6)}${String(n).padStart(3, "0")}`;

let cookie = "";
async function call(p: string, init: RequestInit & { anon?: boolean } = {}) {
  const headers = new Headers(init.headers);
  if (!init.anon && cookie) headers.set("cookie", cookie);
  if (init.method && init.method !== "GET") headers.set("origin", headers.get("origin") ?? BASE);
  return fetch(BASE + p, { ...init, headers, redirect: "manual" });
}

type Details = Record<string, unknown>;
const baseDetails = (jobId: string, over: Details = {}): Details => ({
  jobId,
  fullName: "Smoke Priya Sharma",
  dateOfBirth: "1998-04-12",
  email: `priya-${RUN}@smoke.example.test`,
  city: "Mohali",
  education: "B.Sc (Life Sciences)",
  experienceYears: 2,
  experienceMonths: 6,
  currentCtcLpa: 2.4,
  expectedCtcLpa: 3.5,
  noticeDays: 30,
  languages: ["English", "Hindi"],
  source: "Naukri",
  hrNotes: null,
  certifications: ["CPC"],
  codingSpecialties: ["E/M"],
  ehrSoftware: ["Epic"],
  nightShiftOk: true,
  voiceProcess: false,
  typingWpm: 35,
  skills: "denial management, Excel",
  ...over,
});
const consent = (over: Details = {}) => ({ agreed: true, language: "en", noticeVersion: NOTICE_VERSION, talentPool: true, whatsapp: false, ...over });

function intakeForm(body: unknown, files: { photo?: boolean; pages?: number } = { photo: true, pages: 0 }) {
  const fd = new FormData();
  fd.set("data", JSON.stringify(body));
  if (files.photo) fd.set("photo", jpeg("photo"), "photo.jpg");
  for (let i = 0; i < (files.pages ?? 0); i++) fd.append("cvPage", jpeg(`page${i}`), `page-${i + 1}.jpg`);
  return fd;
}
const postIntake = (body: unknown, files?: { photo?: boolean; pages?: number }) => call("/api/intake", { method: "POST", body: intakeForm(body, files) });

const filesOnDisk = (root: string, tenantId: string) => {
  const dir = path.join(root, tenantId);
  return fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).length : 0;
};

async function makeTenant(slug: string) {
  const [t] = await db.insert(s.tenants).values({ name: `Smoke ${slug}`, slug: `smoke-${slug}-${RUN}`, tokenPrefix: "SM" }).returning();
  await db.insert(s.stages).values(["Registered", "HR screen"].map((name, i) => ({ tenantId: t.id, name, position: i + 1 })));
  await db.insert(s.locations).values({ tenantId: t.id, name: "Smoke office" });
  const jobsRows = await db
    .insert(s.jobs)
    .values([
      { tenantId: t.id, title: "Smoke AR Caller" },
      { tenantId: t.id, title: "Smoke Closed Job", status: "closed", active: false },
    ])
    .returning();
  return { tenant: t, open: jobsRows[0], closed: jobsRows[1] };
}

async function cleanup(tenantIds: string[], root: string | null) {
  if (tenantIds.length === 0) return;
  const t = inArray(s.candidateFiles.tenantId, tenantIds);
  await db.delete(s.candidateFiles).where(t);
  await db.delete(s.consents).where(inArray(s.consents.tenantId, tenantIds));
  await db.delete(s.applications).where(inArray(s.applications.tenantId, tenantIds));
  await db.delete(s.candidates).where(inArray(s.candidates.tenantId, tenantIds));
  await db.delete(s.dailyCounters).where(inArray(s.dailyCounters.tenantId, tenantIds));
  await db.delete(s.auditLog).where(inArray(s.auditLog.tenantId, tenantIds));
  await db.delete(s.users).where(inArray(s.users.tenantId, tenantIds)); // sessions + accounts cascade
  await db.delete(s.jobs).where(inArray(s.jobs.tenantId, tenantIds));
  await db.delete(s.stages).where(inArray(s.stages.tenantId, tenantIds));
  await db.delete(s.locations).where(inArray(s.locations.tenantId, tenantIds));
  await db.delete(s.tenants).where(inArray(s.tenants.id, tenantIds));
  if (root) for (const id of tenantIds) fs.rmSync(path.join(root, id), { recursive: true, force: true });
}

async function main() {
  const root = uploadRoot();
  if (!root) throw new Error("UPLOAD_DIR must be set to an absolute path (same as the server's).");
  const created: string[] = [];
  try {
    const A = await makeTenant("a");
    const B = await makeTenant("b");
    created.push(A.tenant.id, B.tenant.id);
    const hr = { email: `hr-${RUN}@smoke.example.test`, password: `Smoke-${crypto.randomUUID()}` };
    await db.transaction((tx) => createStaff(tx, { tenantId: A.tenant.id, name: "Smoke HR", email: hr.email, role: "hr", password: hr.password, temporary: false }));

    // Tenant B: one candidate with a photo row, to prove A can't reach it.
    const [bCand] = await db.insert(s.candidates).values({ tenantId: B.tenant.id, fullName: "Smoke Other Tenant", mobile: mobileFor(900) }).returning();
    const [bFile] = await db
      .insert(s.candidateFiles)
      .values({ tenantId: B.tenant.id, candidateId: bCand.id, kind: "photo", storageKey: `${B.tenant.id}/${bCand.id}/x.jpg`, mimeType: "image/jpeg", sizeBytes: 1 })
      .returning();

    const m1 = mobileFor(1), m2 = mobileFor(2), m3 = mobileFor(3);

    let r = await call(`/api/candidates/lookup?mobile=${m1}`, { anon: true });
    check("lookup signed out → 401", r.status === 401, r.status);

    r = await call("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(hr) });
    cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    check("HR signs in", r.status === 200 && cookie.includes("session_token"), r.status);

    r = await call(`/api/candidates/lookup?mobile=12345`);
    check("lookup with a bad mobile → 400", r.status === 400, r.status);
    r = await call(`/api/candidates/lookup?mobile=${encodeURIComponent(`+91 ${m1.slice(0, 5)}-${m1.slice(5)}`)}`);
    let j = await r.json();
    check("lookup normalises +91 / spaces / dashes, new mobile → not found", r.status === 200 && j.found === false && j.mobile === m1, j);

    const req1 = { clientRequestId: crypto.randomUUID(), mobile: m1, details: baseDetails(A.open.id), consent: consent() };
    r = await postIntake(req1, { photo: false });
    j = await r.json();
    check("intake without photo → 400", r.status === 400 && /photo/i.test(j.error), j);
    r = await postIntake({ ...req1, details: baseDetails(A.open.id, { dateOfBirth: `${new Date().getFullYear() - 17}-01-01` }) });
    j = await r.json();
    check("intake under 18 → 400", r.status === 400 && /18/.test(j.error), j);
    r = await postIntake({ ...req1, consent: consent({ agreed: false }) });
    j = await r.json();
    check("intake without consent → 400", r.status === 400 && /consent/i.test(j.error), j);
    r = await postIntake({ ...req1, consent: consent({ noticeVersion: "old" }) });
    check("intake with an outdated notice version → 400", r.status === 400, r.status);
    r = await postIntake({ ...req1, details: baseDetails(A.closed.id) });
    j = await r.json();
    check("intake for a closed job → 400", r.status === 400 && /not open/i.test(j.error), j);
    r = await postIntake({ ...req1, details: baseDetails(B.open.id) });
    check("intake for another tenant's job → 400", r.status === 400, r.status);
    r = await call("/api/intake", { method: "POST", body: intakeForm(req1, { photo: true, pages: 2 }), headers: { origin: "http://evil.example" } });
    check("cross-site intake POST → 403", r.status === 403, r.status);
    check("rejected saves wrote no files", filesOnDisk(root, A.tenant.id) === 0, filesOnDisk(root, A.tenant.id));

    r = await postIntake(req1, { photo: true, pages: 2 });
    const first = await r.json();
    check("first save → 201, token A-001", r.status === 201 && first.token === "A-001" && first.returning === false, first);

    r = await postIntake(req1, { photo: true, pages: 2 });
    j = await r.json();
    const apps1 = await db.$count(s.applications, eq(s.applications.candidateId, first.candidateId));
    const files1 = await db.$count(s.candidateFiles, eq(s.candidateFiles.candidateId, first.candidateId));
    check("retry same client_request_id → same token, no duplicate", r.status === 200 && j.token === "A-001" && apps1 === 1 && files1 === 3, { status: r.status, token: j.token, apps1, files1 });
    check("files stored under UPLOAD_DIR/<tenant>/<candidate>/", fs.readdirSync(path.join(root, A.tenant.id, first.candidateId)).length === 3);

    const [consentRow] = await db.select().from(s.consents).where(eq(s.consents.applicationId, first.applicationId));
    check("consent row saved with version, language, purposes", consentRow?.noticeVersion === NOTICE_VERSION && consentRow.language === "en" && consentRow.talentPool === true && consentRow.whatsapp === false, consentRow);
    const [cand] = await db.select().from(s.candidates).where(eq(s.candidates.id, first.candidateId));
    check("money stored as whole rupees (2.4 / 3.5 LPA)", cand.currentCtc === 240000 && cand.expectedCtc === 350000, [cand.currentCtc, cand.expectedCtc]);
    check("RCM fields stored", cand.certifications.join() === "CPC" && cand.ehrSoftware.join() === "Epic" && cand.nightShiftOk === true && cand.typingWpm === 35 && cand.experienceMonths === 30, cand);

    r = await call(`/api/candidates/lookup?mobile=${m1}`);
    j = await r.json();
    check("returning candidate found with photo, prefill and visit", j.found && j.photoFileId && j.prefill.fullName === "Smoke Priya Sharma" && j.visits.length === 1 && j.today?.token === "A-001" && j.prefill.expectedCtcLpa === 3.5, j);
    check("no cooldown without a rejection", j.cooldown === null, j.cooldown);
    const photoId: string = j.photoFileId;

    r = await postIntake({ ...req1, clientRequestId: crypto.randomUUID() }, { photo: true });
    j = await r.json();
    check("second visit → A-002, marked returning", r.status === 201 && j.token === "A-002" && j.returning === true, j);

    // Double tap: two identical requests at once → one application, same token, no orphan files.
    const req2 = { clientRequestId: crypto.randomUUID(), mobile: m2, details: baseDetails(A.open.id, { fullName: "Smoke Priya Sharmaa", email: null, certifications: [], codingSpecialties: [], ehrSoftware: ["eClinicalWorks"], nightShiftOk: false, voiceProcess: true, skills: "payment posting" }), consent: consent({ talentPool: false }) };
    const [d1, d2] = await Promise.all([postIntake(req2, { photo: true, pages: 1 }), postIntake(req2, { photo: true, pages: 1 })]);
    const [b1, b2] = await Promise.all([d1.json(), d2.json()]);
    const dupApps = await db.$count(s.applications, eq(s.applications.clientRequestId, req2.clientRequestId));
    const dbFiles = await db.$count(s.candidateFiles, eq(s.candidateFiles.tenantId, A.tenant.id));
    check("double-tap Save → one application, same token", b1.token === b2.token && b1.token === "A-003" && dupApps === 1, { b1: b1.token ?? b1, b2: b2.token ?? b2, dupApps });
    check("no orphan files on disk after the losing request", filesOnDisk(root, A.tenant.id) === dbFiles, { disk: filesOnDisk(root, A.tenant.id), db: dbFiles });
    check("similar name + same DOB under another mobile → possible duplicate", b1.duplicates?.some((d: { id: string; reason: string }) => d.id === first.candidateId && /similar name/.test(d.reason)), b1.duplicates);

    const req3 = { clientRequestId: crypto.randomUUID(), mobile: m3, details: baseDetails(A.open.id, { fullName: "Smoke Rahul Verma", dateOfBirth: "1995-09-01", certifications: ["CCS"], codingSpecialties: [], ehrSoftware: ["NextGen"], nightShiftOk: false, skills: "charge entry" }), consent: consent() };
    r = await postIntake(req3);
    j = await r.json();
    check("same email under another mobile → possible duplicate", r.status === 201 && j.token === "A-004" && j.duplicates.some((d: { id: string; reason: string }) => d.id === first.candidateId && d.reason === "same email"), j);

    const page = async (qs: string) => (await call(`/dashboard?${qs}`)).text();
    const names = (html: string) => ["Smoke Priya Sharma<", "Smoke Priya Sharmaa<", "Smoke Rahul Verma<"].map((n) => html.includes(n));
    const expect = async (label: string, qs: string, want: boolean[]) => {
      const got = names(await page(qs));
      check(`search ${label}`, got.join() === want.join(), { qs, got });
    };
    await expect("by skill (denial)", "q=denial", [true, false, false]);
    await expect("by certification text (CPC)", "q=CPC", [true, false, false]);
    await expect("by certification filter (CPC)", "cert=CPC", [true, false, false]);
    await expect("by software (Epic)", "q=epic", [true, false, false]);
    await expect("by software filter (Epic)", "ehr=Epic", [true, false, false]);
    await expect("night shift filter", "night=yes", [true, false, false]);
    await expect("voice process filter", "voice=yes", [false, true, false]);
    await expect("talent pool filter", "pool=yes", [true, false, true]);
    await expect("fuzzy name (Rahul Varma)", "q=Rahul+Varma", [false, false, true]);
    await expect("fuzzy name (Pirya Sharma)", "q=Pirya+Sharma", [true, true, false]);
    await expect("partial mobile (last 5 digits)", `q=${m3.slice(-5)}`, [false, false, true]);
    await expect("email (part with @)", `q=priya-${RUN}%40smoke`, [true, false, true]);
    await expect("city full text (mohali)", "q=mohali", [true, true, true]);
    await expect("position filter, other job", `job=${A.closed.id}`, [false, false, false]);
    const empty = await page("q=zzzzqqq");
    check("no results → empty state", empty.includes("No candidates match"));
    const garbage = await call("/dashboard?page=abc&status=bogus&job=not-a-uuid&from=x");
    check("bad filter values in URL are ignored, not a 500", garbage.status === 200, garbage.status);

    r = await call(`/api/files/${photoId}`);
    check(
      "file served to same-tenant staff with nosniff + private cache",
      r.status === 200 && r.headers.get("content-type") === "image/jpeg" && r.headers.get("x-content-type-options") === "nosniff" && /private/.test(r.headers.get("cache-control") ?? ""),
      [r.status, ...r.headers],
    );
    r = await call(`/api/files/${photoId}`, { anon: true });
    check("file signed out → 401", r.status === 401, r.status);
    r = await call(`/api/files/${bFile.id}`);
    check("file of another tenant → 404", r.status === 404, r.status);
    r = await call(`/api/files/not-a-uuid`);
    check("file with a malformed id → 404", r.status === 404, r.status);

    r = await call(`/dashboard/candidates/${first.candidateId}`);
    const profile = await r.text();
    const cvPages = await db.select({ id: s.candidateFiles.id }).from(s.candidateFiles).where(sql`${s.candidateFiles.candidateId} = ${first.candidateId} and ${s.candidateFiles.kind} = 'cv_page'`);
    check("profile shows CV pages", r.status === 200 && cvPages.length === 2 && cvPages.every((p) => profile.includes(`/api/files/${p.id}`)) && /Page (<!-- -->)?2/.test(profile), { status: r.status, pages: cvPages.length, ids: cvPages.map((p) => profile.includes(p.id)) });
    check("profile shows RCM fields and consent", profile.includes("CPC") && profile.includes("Epic") && profile.includes(NOTICE_VERSION) && profile.includes("3.5 LPA"));
    r = await call(`/dashboard/candidates/${bCand.id}`);
    check("profile of another tenant → 404", r.status === 404, r.status);

    const audits = await db.select().from(s.auditLog).where(eq(s.auditLog.tenantId, A.tenant.id));
    check("profile view audited (candidate.view)", audits.some((a) => a.action === "candidate.view" && a.entityId === first.candidateId));
    const pii = [m1, m2, m3, "Smoke Priya", "Rahul", "@smoke.example.test", "Mohali"];
    check("audit meta holds ids and codes only", audits.every((a) => !pii.some((p) => JSON.stringify(a.meta ?? {}).includes(p))), audits.map((a) => a.meta));

    r = await call("/api/settings/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "x" }) });
    check("HR can't change settings → 403", r.status === 403, r.status);
  } finally {
    await cleanup(created, root);
    const left = created.length ? await db.$count(s.tenants, inArray(s.tenants.id, created)) : 0;
    check("cleanup removed smoke tenants and files", left === 0 && created.every((id) => !fs.existsSync(path.join(root, id))), left);
  }
}

main()
  .catch((e) => {
    console.error(e);
    results.push({ name: "smoke crashed", ok: false });
  })
  .finally(async () => {
    await pgClient.end();
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed against ${BASE}`);
    process.exitCode = failed ? 1 : 0;
  });
