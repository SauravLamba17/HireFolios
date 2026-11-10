import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db, isUuid } from "@/db";
import { applications, candidateFiles, candidates, consents, jobs, stages, users } from "@/db/schema";
import { StatusBadge, Tag } from "@/components/status-badge";
import { formatDateTimeIST, formatDayIST } from "@/lib/ist";
import { formatLpa } from "@/lib/money";
import { NOTICE_LANGUAGES } from "@/lib/notice";
import { experienceLabel, noticeLabel } from "@/lib/options";
import { requireStaff } from "@/lib/session";
import { audit } from "@/lib/staff";

export const metadata: Metadata = { title: "Candidate" };

const yesNo = (v: boolean | null) => (v === null ? null : v ? "Yes" : "No");

function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-sm text-slate-500">{k}</dt>
          <dd className="text-base text-slate-900">{v === null || v === undefined || v === "" ? <span className="text-slate-400">—</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("candidates");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const tenantId = staff.tenantId;

  const c = await db.query.candidates.findFirst({ where: and(eq(candidates.id, id), eq(candidates.tenantId, tenantId)) });
  if (!c) notFound(); // another tenant's id looks exactly like a missing one

  const [visits, files, consentRows] = await Promise.all([
    db
      .select({
        id: applications.id,
        token: applications.token,
        day: applications.tokenDate,
        job: jobs.title,
        stage: stages.name,
        outcome: applications.outcome,
        rejectReason: applications.rejectReason,
        source: applications.source,
        hrNotes: applications.hrNotes,
        by: users.name,
      })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .innerJoin(stages, eq(stages.id, applications.currentStageId))
      .leftJoin(users, eq(users.id, applications.createdBy))
      .where(and(eq(applications.tenantId, tenantId), eq(applications.candidateId, id)))
      .orderBy(desc(applications.tokenDate), desc(applications.createdAt)),
    db
      .select({ id: candidateFiles.id, kind: candidateFiles.kind, applicationId: candidateFiles.applicationId, pageNo: candidateFiles.pageNo, mimeType: candidateFiles.mimeType, createdAt: candidateFiles.createdAt })
      .from(candidateFiles)
      .where(and(eq(candidateFiles.tenantId, tenantId), eq(candidateFiles.candidateId, id), isNull(candidateFiles.deletedAt)))
      .orderBy(desc(candidateFiles.createdAt), asc(candidateFiles.pageNo)),
    db
      .select()
      .from(consents)
      .where(and(eq(consents.tenantId, tenantId), eq(consents.candidateId, id)))
      .orderBy(desc(consents.acceptedAt)),
  ]);

  await audit(db, { tenantId, actorUserId: staff.id, action: "candidate.view", entityType: "candidate", entityId: id });

  const photo = files.find((f) => f.kind === "photo");
  const tokenOf = new Map(visits.map((v) => [v.id, `${v.token} · ${formatDayIST(v.day)}`]));
  const cvByVisit = visits
    .map((v) => ({ visit: v, pages: files.filter((f) => f.kind === "cv_page" && f.applicationId === v.id).sort((a, b) => (a.pageNo ?? 0) - (b.pageNo ?? 0)) }))
    .filter((g) => g.pages.length > 0);
  const uploads = files.filter((f) => f.kind === "cv_upload");
  const latestConsent = consentRows[0];
  const inPool = latestConsent?.talentPool && !latestConsent.withdrawnAt;

  return (
    <div className="space-y-6">
      <Link href="/dashboard" className="text-blue-700 underline">← All candidates</Link>

      <section className="card flex flex-wrap gap-6" aria-labelledby="name-h">
        {photo ? (
          <a href={`/api/files/${photo.id}`} target="_blank" rel="noreferrer" title="Open full size">
            <Image src={`/api/files/${photo.id}`} unoptimized width={150} height={200} alt={`Photo of ${c.fullName}`} className="h-[200px] w-[150px] rounded-lg object-cover" />
          </a>
        ) : (
          <div className="grid h-[200px] w-[150px] place-items-center rounded-lg bg-slate-100 text-slate-500">No photo</div>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <h1 id="name-h" className="text-2xl font-semibold">{c.fullName}</h1>
          <p className="text-lg text-slate-700">
            {c.mobile}
            {c.email && <span className="break-all"> · {c.email}</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {visits[0] && <StatusBadge outcome={visits[0].outcome} stage={visits[0].stage} />}
            {inPool && <Tag>Talent pool</Tag>}
            {latestConsent?.whatsapp && !latestConsent.withdrawnAt && <Tag>WhatsApp OK</Tag>}
          </div>
          <p className="text-sm text-slate-500">
            Added {formatDateTimeIST(c.createdAt)} · updated {formatDateTimeIST(c.updatedAt)}
          </p>
        </div>
      </section>

      <section className="card space-y-4" aria-labelledby="det-h">
        <h2 id="det-h" className="text-lg font-semibold">Details</h2>
        <Facts
          items={[
            ["Date of birth", c.dateOfBirth && formatDayIST(c.dateOfBirth)],
            ["City", c.city],
            ["Education", c.qualification],
            ["Experience", experienceLabel(c.experienceMonths)],
            ["Current CTC", formatLpa(c.currentCtc)],
            ["Expected CTC", formatLpa(c.expectedCtc)],
            ["Notice period", noticeLabel(c.noticeDays)],
            ["Languages", c.languages.join(", ")],
          ]}
        />
      </section>

      <section className="card space-y-4" aria-labelledby="rcm-h">
        <h2 id="rcm-h" className="text-lg font-semibold">Medical billing / RCM</h2>
        <Facts
          items={[
            ["Certifications", c.certifications.join(", ")],
            ["Coding specialties", c.codingSpecialties.join(", ")],
            ["EHR / PM software", c.ehrSoftware.join(", ")],
            ["Night / US shift OK", yesNo(c.nightShiftOk)],
            ["Voice process OK", yesNo(c.voiceProcess)],
            ["Typing speed", c.typingWpm && `${c.typingWpm} WPM`],
            ["Skills", c.skills],
          ]}
        />
      </section>

      <section className="card space-y-4 overflow-x-auto" aria-labelledby="vis-h">
        <h2 id="vis-h" className="text-lg font-semibold">Visits ({visits.length})</h2>
        {visits.length === 0 ? (
          <p className="text-slate-600">No visits.</p>
        ) : (
          <table className="w-full min-w-[640px] text-left">
            <thead className="border-b border-slate-200 text-sm text-slate-600">
              <tr>
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 font-medium">Token</th>
                <th className="py-2 pr-4 font-medium">Position</th>
                <th className="py-2 pr-4 font-medium">Stage / outcome</th>
                <th className="py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {visits.map((v) => (
                <tr key={v.id}>
                  <td className="py-3 pr-4 whitespace-nowrap">{formatDayIST(v.day)}</td>
                  <td className="py-3 pr-4 font-medium whitespace-nowrap">{v.token}</td>
                  <td className="py-3 pr-4">{v.job}</td>
                  <td className="py-3 pr-4">
                    <StatusBadge outcome={v.outcome} stage={v.stage} />
                    {v.rejectReason && <div className="mt-1 text-sm text-slate-600">Reason: {v.rejectReason}</div>}
                  </td>
                  <td className="py-3 text-sm text-slate-700">
                    {v.hrNotes && <p className="whitespace-pre-line">{v.hrNotes}</p>}
                    <p className="text-slate-500">
                      {[v.source && `Source: ${v.source}`, v.by && `Registered by ${v.by}`].filter(Boolean).join(" · ")}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card space-y-4" aria-labelledby="cv-h">
        <h2 id="cv-h" className="text-lg font-semibold">CV</h2>
        {cvByVisit.length === 0 && uploads.length === 0 && <p className="text-slate-600">No CV saved.</p>}
        {cvByVisit.map(({ visit, pages }) => (
          <div key={visit.id} className="space-y-2">
            <h3 className="text-sm font-medium text-slate-600">
              {pages.length} page{pages.length === 1 ? "" : "s"} · visit {tokenOf.get(visit.id)}
            </h3>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6" aria-label={`CV pages from visit ${visit.token}`}>
              {pages.map((p) => (
                <li key={p.id}>
                  <a href={`/api/files/${p.id}`} target="_blank" rel="noreferrer" className="block">
                    <Image
                      src={`/api/files/${p.id}`}
                      unoptimized
                      width={180}
                      height={240}
                      loading="lazy"
                      alt={`CV page ${p.pageNo}`}
                      className="aspect-[3/4] w-full rounded-md border border-slate-200 bg-slate-50 object-contain"
                    />
                    <span className="text-sm text-slate-600">Page {p.pageNo}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {uploads.map((u) => (
          <p key={u.id}>
            <a href={`/api/files/${u.id}`} target="_blank" rel="noreferrer" className="btn btn-secondary">
              Open uploaded CV ({u.mimeType === "application/pdf" ? "PDF" : "image"})
            </a>
            <span className="ml-3 text-sm text-slate-600">{u.applicationId && `visit ${tokenOf.get(u.applicationId)}`}</span>
          </p>
        ))}
      </section>

      <section className="card space-y-4 overflow-x-auto" aria-labelledby="con-h">
        <h2 id="con-h" className="text-lg font-semibold">Consent record</h2>
        {consentRows.length === 0 ? (
          <p className="text-slate-600">No consent recorded.</p>
        ) : (
          <table className="w-full min-w-[640px] text-left">
            <thead className="border-b border-slate-200 text-sm text-slate-600">
              <tr>
                <th className="py-2 pr-4 font-medium">Given</th>
                <th className="py-2 pr-4 font-medium">Language</th>
                <th className="py-2 pr-4 font-medium">Notice version</th>
                <th className="py-2 font-medium">Purposes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {consentRows.map((k) => (
                <tr key={k.id}>
                  <td className="py-3 pr-4 whitespace-nowrap">
                    {formatDateTimeIST(k.acceptedAt)}
                    {k.applicationId && <div className="text-sm text-slate-500">visit {tokenOf.get(k.applicationId)}</div>}
                  </td>
                  <td className="py-3 pr-4">{NOTICE_LANGUAGES.find((l) => l.value === k.language)?.label ?? k.language}</td>
                  <td className="py-3 pr-4 font-mono text-sm">{k.noticeVersion}</td>
                  <td className="py-3 text-sm">
                    <ul>
                      <li>✓ Assess this application (required)</li>
                      <li>{k.talentPool ? "✓" : "✗"} Talent pool</li>
                      <li>{k.whatsapp ? "✓" : "✗"} WhatsApp contact</li>
                    </ul>
                    {k.withdrawnAt && <p className="mt-1 font-medium text-red-700">Withdrawn {formatDateTimeIST(k.withdrawnAt)}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
