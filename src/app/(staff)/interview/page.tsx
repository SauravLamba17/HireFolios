import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { applications, candidateFiles, candidates, jobs, panels, queueEvents, rejectReasons, scorecards, stages, users } from "@/db/schema";
import { Elapsed } from "@/components/elapsed";
import { LiveRefresh } from "@/components/live-refresh";
import { stageList, todayDrive } from "@/lib/drive";
import { formatDateTimeIST, formatDayIST } from "@/lib/ist";
import { formatLpa } from "@/lib/money";
import { DECISION_LABELS, experienceLabel, noticeLabel } from "@/lib/options";
import { requireStaff } from "@/lib/session";
import { InterviewForm, StatusToggle } from "./interview-form";

export const metadata: Metadata = { title: "Interview" };

const yesNo = (v: boolean | null) => (v === null ? "—" : v ? "Yes" : "No");

export default async function InterviewPage() {
  const staff = await requireStaff("interview");
  const drive = await todayDrive(db, staff.tenantId);
  const [panel] = await db
    .select({ id: panels.id, name: panels.name, status: panels.status, stageId: panels.stageId })
    .from(panels)
    .where(and(eq(panels.tenantId, staff.tenantId), eq(panels.driveId, drive.id), eq(panels.interviewerId, staff.id), ne(panels.status, "closed")));

  if (!panel) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">Interview</h1>
        <LiveRefresh />
        <p className="card text-slate-700">You are not on a panel today. Ask HR to add you on the drive board.</p>
      </div>
    );
  }

  const info = await stageList(db, staff.tenantId);
  const stage = info.find((s) => s.id === panel.stageId);
  const [app] = await db
    .select({
      id: applications.id,
      token: applications.token,
      day: applications.tokenDate,
      stageId: applications.currentStageId,
      hrNotes: applications.hrNotes,
      job: jobs.title,
      c: candidates,
    })
    .from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.tenantId, staff.tenantId), eq(applications.panelId, panel.id), eq(applications.outcome, "in_progress")));

  const [files, rounds, reasons, [called]] = app
    ? await Promise.all([
        db
          .select({ id: candidateFiles.id, kind: candidateFiles.kind, pageNo: candidateFiles.pageNo, mime: candidateFiles.mimeType, createdAt: candidateFiles.createdAt })
          .from(candidateFiles)
          .where(and(eq(candidateFiles.tenantId, staff.tenantId), eq(candidateFiles.candidateId, app.c.id), isNull(candidateFiles.deletedAt)))
          .orderBy(desc(candidateFiles.createdAt), asc(candidateFiles.pageNo)),
        db
          .select({ stage: stages.name, by: users.name, scores: scorecards.scores, overall: scorecards.overall, decision: scorecards.decision, reason: scorecards.rejectReason, notes: scorecards.comments, at: scorecards.updatedAt })
          .from(scorecards)
          .innerJoin(stages, eq(stages.id, scorecards.stageId))
          .innerJoin(users, eq(users.id, scorecards.interviewerId))
          .where(and(eq(scorecards.tenantId, staff.tenantId), eq(scorecards.applicationId, app.id)))
          .orderBy(asc(scorecards.updatedAt)),
        db
          .select({ label: rejectReasons.label })
          .from(rejectReasons)
          .where(and(eq(rejectReasons.tenantId, staff.tenantId), eq(rejectReasons.active, true)))
          .orderBy(asc(rejectReasons.position)),
        db
          .select({ at: queueEvents.createdAt })
          .from(queueEvents)
          .where(and(eq(queueEvents.applicationId, app.id), eq(queueEvents.event, "called")))
          .orderBy(desc(queueEvents.createdAt))
          .limit(1),
      ])
    : [[], [], [], []];
  const photo = files.find((f) => f.kind === "photo");
  const pages = files.filter((f) => f.kind === "cv_page");
  const upload = files.find((f) => f.kind === "cv_upload");
  const latestPages = pages.length ? pages.filter((p) => p.createdAt.getTime() === pages[0].createdAt.getTime()) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Interview · {panel.name}</h1>
          <p className="mt-1 text-slate-600">
            {stage?.name} · {panel.status === "busy" ? "With a candidate" : panel.status === "away" ? "Away" : "Available"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <LiveRefresh />
          <StatusToggle status={panel.status as "available" | "away" | "busy"} />
        </div>
      </div>

      {!app ? (
        <p className="card text-slate-700">{panel.status === "away" ? "You are away. Set yourself available to get the next candidate." : "Waiting for HR to send the next candidate."}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <section className="card flex gap-4" aria-labelledby="cand-h">
              {photo ? (
                <Image src={`/api/files/${photo.id}`} unoptimized width={120} height={160} alt={`Photo of ${app.c.fullName}`} className="h-40 w-30 rounded-lg object-cover" />
              ) : (
                <div className="grid h-40 w-30 place-items-center rounded-lg bg-slate-100 text-sm text-slate-500">No photo</div>
              )}
              <div className="min-w-0 space-y-1">
                <p className="text-sm text-slate-600">
                  Token <strong className="text-slate-900">{app.token}</strong>
                  {called && <> · in room <Elapsed since={called.at.toISOString()} /></>}
                </p>
                <h2 id="cand-h" className="text-xl font-semibold">{app.c.fullName}</h2>
                <p className="text-slate-700">{app.job}</p>
                <Link href={`/dashboard/candidates/${app.c.id}`} target="_blank" className="text-sm text-blue-700 underline">Full profile ↗</Link>
              </div>
            </section>

            <section className="card" aria-label="Details">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {[
                  ["Experience", experienceLabel(app.c.experienceMonths) ?? "—"],
                  ["Education", app.c.qualification ?? "—"],
                  ["City", app.c.city ?? "—"],
                  ["Notice", noticeLabel(app.c.noticeDays) ?? "—"],
                  ["Current CTC", formatLpa(app.c.currentCtc) ?? "—"],
                  ["Expected CTC", formatLpa(app.c.expectedCtc) ?? "—"],
                  ["Certifications", app.c.certifications.join(", ") || "—"],
                  ["Coding specialties", app.c.codingSpecialties.join(", ") || "—"],
                  ["EHR / PM software", app.c.ehrSoftware.join(", ") || "—"],
                  ["Typing speed", app.c.typingWpm ? `${app.c.typingWpm} WPM` : "—"],
                  ["Night / US shift OK", yesNo(app.c.nightShiftOk)],
                  ["Voice process OK", yesNo(app.c.voiceProcess)],
                  ["Languages", app.c.languages.join(", ") || "—"],
                  ["Skills", app.c.skills ?? "—"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-slate-500">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              {app.hrNotes && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm whitespace-pre-line">HR notes: {app.hrNotes}</p>}
            </section>

            <section className="card space-y-3" aria-labelledby="prev-h">
              <h2 id="prev-h" className="text-lg font-semibold">Earlier rounds this visit</h2>
              {rounds.length === 0 && <p className="text-sm text-slate-600">This is the first round.</p>}
              {rounds.map((r, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <p className="font-medium">
                    {r.stage} · {r.by} · {r.decision ? DECISION_LABELS[r.decision] : "—"}
                    {r.reason && ` (${r.reason})`}
                    <span className="font-normal text-slate-500"> · {formatDateTimeIST(r.at)}</span>
                  </p>
                  <p className="text-slate-700">
                    {Object.entries(r.scores).map(([k, v]) => `${k} ${v}/5`).join(" · ") || "No scores"}
                    {r.overall && ` · overall ${r.overall}/5`}
                  </p>
                  {r.notes && <p className="mt-1 whitespace-pre-line text-slate-600">{r.notes}</p>}
                </div>
              ))}
            </section>

            {stage && <InterviewForm key={app.id} applicationId={app.id} token={app.token} criteria={stage.criteria} reasons={reasons.map((r) => r.label)} />}
          </div>

          <section className="card space-y-3 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto" aria-labelledby="cv-h">
            <h2 id="cv-h" className="text-lg font-semibold">CV</h2>
            {latestPages.length === 0 && !upload && <p className="text-sm text-slate-600">No CV saved.</p>}
            {upload && (
              <a href={`/api/files/${upload.id}`} target="_blank" rel="noreferrer" className="btn btn-secondary">
                Open uploaded CV ({upload.mime === "application/pdf" ? "PDF" : "image"}) ↗
              </a>
            )}
            {latestPages.map((p) => (
              <a key={p.id} href={`/api/files/${p.id}`} target="_blank" rel="noreferrer" className="block">
                <Image src={`/api/files/${p.id}`} unoptimized width={900} height={1200} alt={`CV page ${p.pageNo}`} className="w-full rounded-md border border-slate-200" />
                <span className="text-sm text-slate-600">Page {p.pageNo} · tap to open full size</span>
              </a>
            ))}
            {pages.length > latestPages.length && <p className="text-sm text-slate-500">Older CV pages are on the full profile ({formatDayIST(app.day)} visit shown).</p>}
          </section>
        </div>
      )}
    </div>
  );
}
