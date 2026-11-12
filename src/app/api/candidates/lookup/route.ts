import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { applications, candidateFiles, candidates, jobs, stages, tenants } from "@/db/schema";
import { normalizeMobile, type LookupResult } from "@/lib/intake";
import { todayIST } from "@/lib/ist";
import { rupeesToLpa } from "@/lib/money";
import { doNotRehireOf } from "@/lib/rediscovery/data";
import { requireStaffApi } from "@/lib/session";
import { audit } from "@/lib/staff";

// HR at intake: is this mobile a returning candidate? Prefill, recent visits, cooldown.
export async function GET(req: Request) {
  const { staff, error } = await requireStaffApi(req, "intake");
  if (error) return error;
  const mobile = normalizeMobile(new URL(req.url).searchParams.get("mobile") ?? "");
  if (!mobile) {
    return Response.json({ error: "Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9" }, { status: 400 });
  }
  const tenantId = staff.tenantId;

  const c = await db.query.candidates.findFirst({ where: and(eq(candidates.tenantId, tenantId), eq(candidates.mobile, mobile)) });
  if (!c) return Response.json({ found: false, mobile } satisfies LookupResult);

  const [visits, [photo], [cooldown], dnr] = await Promise.all([
    db
      .select({
        token: applications.token,
        day: applications.tokenDate,
        job: jobs.title,
        jobId: applications.jobId,
        stage: stages.name,
        outcome: applications.outcome,
        rejectReason: applications.rejectReason,
      })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .innerJoin(stages, eq(stages.id, applications.currentStageId))
      .where(and(eq(applications.tenantId, tenantId), eq(applications.candidateId, c.id)))
      .orderBy(desc(applications.tokenDate), desc(applications.createdAt))
      .limit(10),
    db
      .select({ id: candidateFiles.id })
      .from(candidateFiles)
      .where(and(eq(candidateFiles.tenantId, tenantId), eq(candidateFiles.candidateId, c.id), eq(candidateFiles.kind, "photo"), isNull(candidateFiles.deletedAt)))
      .orderBy(desc(candidateFiles.createdAt))
      .limit(1),
    // Rejected at a visit less than cooldown_days ago.
    db
      .select({ until: sql<string>`(${applications.tokenDate} + ${tenants.cooldownDays})::text`, reason: applications.rejectReason })
      .from(applications)
      .innerJoin(tenants, eq(tenants.id, applications.tenantId))
      .where(
        and(
          eq(applications.tenantId, tenantId),
          eq(applications.candidateId, c.id),
          eq(applications.outcome, "rejected"),
          sql`${applications.tokenDate} + ${tenants.cooldownDays} > ${todayIST()}::date`,
        ),
      )
      .orderBy(desc(applications.tokenDate))
      .limit(1),
    doNotRehireOf(tenantId, c.id),
  ]);

  await audit(db, { tenantId, actorUserId: staff.id, action: "candidate.lookup", entityType: "candidate", entityId: c.id });

  const today = visits.find((v) => v.day === todayIST());
  return Response.json({
    found: true,
    mobile,
    candidateId: c.id,
    photoFileId: photo?.id ?? null,
    prefill: {
      fullName: c.fullName,
      dateOfBirth: c.dateOfBirth,
      email: c.email,
      city: c.city,
      education: c.qualification,
      experienceMonths: c.experienceMonths,
      currentCtcLpa: c.currentCtc === null ? null : rupeesToLpa(c.currentCtc),
      expectedCtcLpa: c.expectedCtc === null ? null : rupeesToLpa(c.expectedCtc),
      noticeDays: c.noticeDays,
      languages: c.languages,
      skills: c.skills,
      certifications: c.certifications,
      codingSpecialties: c.codingSpecialties,
      ehrSoftware: c.ehrSoftware,
      nightShiftOk: c.nightShiftOk,
      voiceProcess: c.voiceProcess,
      typingWpm: c.typingWpm,
      lastJobId: visits[0]?.jobId ?? null,
    },
    visits: visits.map((v) => ({ token: v.token, day: v.day, job: v.job, stage: v.stage, outcome: v.outcome, rejectReason: v.rejectReason })),
    today: today ? { token: today.token, job: today.job } : null,
    cooldown: cooldown ?? null,
    doNotRehire: dnr ? { reason: dnr.note, by: dnr.by, at: dnr.at.toISOString() } : null,
  } satisfies LookupResult);
}
