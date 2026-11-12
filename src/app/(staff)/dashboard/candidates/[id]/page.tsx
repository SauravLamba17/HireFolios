import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db, isUuid } from "@/db";
import { applications, candidateFiles, candidates, consents, contactLog, jobs, otherOffers, stages, users } from "@/db/schema";
import { CallbackBox, ConsentBox, ContactPanel, DncBox } from "@/components/contact";
import { getCompany } from "@/lib/company";
import { callbackReason, CHANNELS, CONTACT_OUTCOMES, coolingWarning, defaultCallbackDay, PURPOSES, renderTemplates, whatsappAllowed } from "@/lib/rediscovery/contact";
import { getSettings } from "@/lib/rediscovery/settings-db";
import { StatusBadge, Tag } from "@/components/status-badge";
import { formatDateIST, formatDateTimeIST, formatDayIST, todayIST } from "@/lib/ist";
import { formatLpa, rupeesToLpa } from "@/lib/money";
import { noticeLabelFrom } from "@/lib/lists";
import { getOptionLists } from "@/lib/lists-db";
import { NOTICE_LANGUAGES } from "@/lib/notice";
import { canViewCandidate } from "@/lib/access";
import { DECISION_LABELS, experienceLabel, OFFER_STATUS_LABELS } from "@/lib/options";
import { can, requireStaff } from "@/lib/session";
import { categoryMap, categoryOf, categoryOptions, contactStates, insights, reasonOptions, risksFor } from "@/lib/rediscovery/data";
import { ageOn } from "@/lib/intake";
import { keepText } from "@/lib/retention";
import { SummaryCard } from "./summary-card";
import { CorrectDetails, OfferForm, OtherOfferForm, OverrideForm, ResumeButton } from "./profile-actions";
import { audit } from "@/lib/staff";

export const metadata: Metadata = { title: "Candidate" };

const yesNo = (v: boolean | null) => (v === null ? null : v ? "Yes" : "No");

function eventText(e: { event: string; stage: string | null; room: string | null; interviewer: string | null }) {
  switch (e.event) {
    case "called":
      return `Called to ${e.room ?? "a panel"}${e.interviewer ? ` (${e.interviewer})` : ""} for ${e.stage}`;
    case "completed":
      return `Finished ${e.stage}`;
    case "queued":
      return `Waiting for ${e.stage}`;
    case "returned":
      return `Back to waiting from ${e.room ?? "a panel"}`;
    case "skipped":
      return "Left the queue";
    default:
      return e.event;
  }
}

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
  const staff = await requireStaff();
  const lists = await getOptionLists(staff.tenantId);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const tenantId = staff.tenantId;
  // Interviewers: only candidates they interviewed. Anyone without access gets the same 404 as a missing id.
  if (!(await canViewCandidate(staff, id))) notFound();

  const c = await db.query.candidates.findFirst({ where: and(eq(candidates.id, id), eq(candidates.tenantId, tenantId)) });
  if (!c) notFound(); // another tenant's id looks exactly like a missing one

  const [visits, files, consentRows, events, cards, stageRows, reasonRows, offersElsewhere] = await Promise.all([
    db
      .select({
        id: applications.id,
        token: applications.token,
        day: applications.tokenDate,
        job: jobs.title,
        stage: stages.name,
        outcome: applications.outcome,
        rejectReason: applications.rejectReason,
        decidedAt: applications.decidedAt,
        purgeAfter: applications.purgeAfter,
        photoPurgeAfter: applications.photoPurgeAfter,
        offerStatus: applications.offerStatus,
        offeredCtc: applications.offeredCtc,
        joiningDate: applications.joiningDate,
        joinedOn: applications.joinedOn,
        source: applications.source,
        hrNotes: applications.hrNotes,
        category: applications.rejectCategory,
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
    db.execute<{ application_id: string; event: string; created_at: Date; note: string | null; stage: string | null; room: string | null; interviewer: string | null; actor: string | null }>(sql`
      select e.application_id, e.event, e.created_at, e.note, s.name as stage, p.name as room, iv.name as interviewer, ac.name as actor
      from queue_events e
      join applications a on a.id = e.application_id
      left join stages s on s.id = e.stage_id
      left join panels p on p.id = e.panel_id
      left join users iv on iv.id = e.interviewer_id
      left join users ac on ac.id = e.actor_user_id
      where a.tenant_id = ${tenantId} and a.candidate_id = ${id}
      order by e.created_at`),
    db.execute<{ application_id: string; stage: string; interviewer: string; scores: Record<string, number>; overall: number | null; decision: string | null; reject_reason: string | null; comments: string | null; updated_at: Date }>(sql`
      select sc.application_id, s.name as stage, u.name as interviewer, sc.scores, sc.overall, sc.decision, sc.reject_reason, sc.comments, sc.updated_at
      from scorecards sc
      join applications a on a.id = sc.application_id
      join stages s on s.id = sc.stage_id
      join users u on u.id = sc.interviewer_id
      where a.tenant_id = ${tenantId} and a.candidate_id = ${id}
      order by sc.updated_at`),
    db.select({ id: stages.id, name: stages.name }).from(stages).where(eq(stages.tenantId, tenantId)).orderBy(asc(stages.position)),
    reasonOptions(tenantId),
    db
      .select({ id: otherOffers.id, company: otherOffers.company, offeredCtc: otherOffers.offeredCtc, joiningDate: otherOffers.joiningDate, notedOn: otherOffers.notedOn, by: users.name })
      .from(otherOffers)
      .leftJoin(users, eq(users.id, otherOffers.createdBy))
      .where(and(eq(otherOffers.tenantId, tenantId), eq(otherOffers.candidateId, id)))
      .orderBy(desc(otherOffers.notedOn), desc(otherOffers.createdAt)),
  ]);
  const cats = categoryMap(lists);
  // cost figures are HR-only: an interviewer sees the reason without them
  const insight = (await insights(tenantId, [id], { hideCost: !can(staff.role, "rediscovery") })).get(id)!;
  const hrOnlyView = can(staff.role, "rediscovery");
  const [contact, settings, company, contacts] = hrOnlyView
    ? await Promise.all([
        contactStates(tenantId, [id]).then((m) => m.get(id)!),
        getSettings(tenantId),
        getCompany(tenantId),
        db
          .select({ id: contactLog.id, at: contactLog.contactedAt, channel: contactLog.channel, purpose: contactLog.purpose, outcome: contactLog.outcome, note: contactLog.note, by: users.name })
          .from(contactLog)
          .leftJoin(users, eq(users.id, contactLog.contactedBy))
          .where(and(eq(contactLog.tenantId, tenantId), eq(contactLog.candidateId, id)))
          .orderBy(desc(contactLog.contactedAt)),
      ])
    : [null, null, null, []];
  const today = todayIST();
  const lastDecided = insight.lastDecided;
  const selectedVisit = visits.find((v) => v.outcome === "selected");
  const risk = hrOnlyView && selectedVisit ? ((await risksFor(tenantId, [selectedVisit.id])).get(selectedVisit.id) ?? []) : null;
  const cooling = contact && settings ? coolingWarning(contact.lastContact, settings.contact_cooling_days) : null;
  const canOverride = can(staff.role, "override");
  const canResume = can(staff.role, "resume");
  const canOffer = can(staff.role, "offer");
  const hrOnly = can(staff.role, "rediscovery"); // HR-only data: cost figures, other offers, tags, contact log
  const expectedLpa = c.expectedCtc === null ? null : rupeesToLpa(c.expectedCtc);

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
      {can(staff.role, "dashboard") && <Link href="/dashboard" className="text-blue-700 underline">← All candidates</Link>}

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

      <SummaryCard
        person={{ id: c.id, fullName: c.fullName, age: c.dateOfBirth ? ageOn(c.dateOfBirth, todayIST()) : null, city: c.city, qualification: c.qualification, certifications: c.certifications, ehrSoftware: c.ehrSoftware, experienceMonths: c.experienceMonths, languages: c.languages }}
        insight={insight}
        keep={keepText(visits, { inPool: Boolean(inPool), until: contact?.poolUntil ?? null }, formatDateIST)}
        hr={
          hrOnly
            ? {
                otherOffer: offersElsewhere[0] ?? null,
                tagOptions: lists.rediscovery_tag.filter((t) => t.active && t.code).map((t) => ({ code: t.code!, label: t.label })),
                facts: [
                  ...(contact?.dnc ? [{ label: "Contact", value: "Do not contact (they asked)", tone: "warn" as const }] : []),
                  { label: "Call-back", value: contact?.callback ? `${contact.callback.dueOn <= today ? "Due" : "On"} ${formatDayIST(contact.callback.dueOn)}` : "None set", tone: contact?.callback && contact.callback.dueOn <= today ? ("warn" as const) : undefined },
                  {
                    label: "Last contacted",
                    value: contact?.lastContact
                      ? `${formatDateIST(contact.lastContact.at)} · ${CHANNELS[contact.lastContact.channel as keyof typeof CHANNELS] ?? contact.lastContact.channel} · ${contact.lastContact.by ?? "—"}${contact.lastContact.outcome ? ` · ${CONTACT_OUTCOMES[contact.lastContact.outcome as keyof typeof CONTACT_OUTCOMES]}` : ""}`
                      : "Never",
                  },
                  ...(risk
                    ? [
                        {
                          label: "Joining-risk hints",
                          value: risk.length ? <ul data-testid="risk-hints">{risk.map((h) => <li key={h.code}>{h.text}</li>)}</ul> : <span data-testid="risk-hints">No risk hints</span>,
                          tone: risk.length ? ("warn" as const) : undefined,
                        },
                      ]
                    : []),
                  { label: "Talent-pool consent", value: inPool ? "Yes" : latestConsent?.withdrawnAt ? `Withdrawn ${formatDateIST(latestConsent.withdrawnAt)}` : "No" },
                ],
              }
            : null
        }
      />

      {hrOnlyView && contact && settings && company && (
        <section className="card space-y-5" aria-labelledby="ct-h">
          <h2 id="ct-h" className="text-lg font-semibold">Contact and call-backs <span className="text-sm font-normal text-slate-500">(HR only)</span></h2>
          <DncBox candidateId={c.id} dnc={contact.dnc ? { reason: contact.dnc.reason, by: contact.dnc.by, at: formatDateIST(contact.dnc.at) } : null} canClear={can(staff.role, "contactUnblock")} />
          {!contact.dnc && (
            <>
              <ContactPanel
                candidateId={c.id}
                mobile={c.mobile}
                cooling={cooling?.text ?? null}
                waAllowed={whatsappAllowed(contact.consent)}
                defaultPurpose={contact.callback ? "callback" : "other"}
                templates={renderTemplates(settings, { name: c.fullName, company: company.shortName, position: visits[0]?.job ?? "", hr_name: staff.name }, contact.callback ? "callback" : "consent")}
              />
              {lastDecided || visits.some((v) => v.outcome === "on_hold") ? (
                <CallbackBox
                  candidateId={c.id}
                  today={today}
                  callback={contact.callback ? { ...contact.callback, dueText: formatDayIST(contact.callback.dueOn) } : null}
                  defaultDay={defaultCallbackDay(lastDecided?.decidedAt ? todayIST(lastDecided.decidedAt) : today, c.noticeDays, settings.callback_default_days)}
                  reason={callbackReason(visits[0]?.outcome ?? "", lastDecided?.category?.code ?? null, lastDecided?.category?.label ?? null)}
                />
              ) : (
                <p className="text-sm text-slate-600">Call-backs can be set once the candidate has a decision.</p>
              )}
            </>
          )}
          <ConsentBox
            candidateId={c.id}
            inPool={Boolean(inPool)}
            poolUntilText={contact.poolUntil ? formatDateIST(contact.poolUntil) : null}
            withdrawnText={latestConsent?.withdrawnAt ? formatDateIST(latestConsent.withdrawnAt) : null}
            today={today}
          />
          <div>
            <h3 className="font-semibold">Contact log ({contacts.length})</h3>
            {contacts.length === 0 ? (
              <p className="text-sm text-slate-600">No contact recorded.</p>
            ) : (
              <ol className="mt-2 space-y-1 border-l-2 border-slate-200 pl-4 text-sm" aria-label="Contact log">
                {contacts.map((x) => (
                  <li key={x.id}>
                    <span className="text-slate-500">{formatDateTimeIST(x.at)}</span> · {CHANNELS[x.channel as keyof typeof CHANNELS] ?? x.channel} ·{" "}
                    {PURPOSES[x.purpose as keyof typeof PURPOSES] ?? x.purpose}
                    {x.outcome && <> · {CONTACT_OUTCOMES[x.outcome as keyof typeof CONTACT_OUTCOMES] ?? x.outcome}</>}
                    {x.note && <span className="text-slate-600"> · {x.note}</span>}
                    <span className="text-slate-500"> · by {x.by ?? "—"}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      )}

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
            ["Notice period", noticeLabelFrom(lists, c.noticeDays)],
            ["Languages", c.languages.join(", ")],
          ]}
        />
      </section>

      {can(staff.role, "privacy") && (
        <CorrectDetails candidateId={c.id} value={{ fullName: c.fullName, mobile: c.mobile, email: c.email, city: c.city, dateOfBirth: c.dateOfBirth }} />
      )}

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

      <section className="space-y-4" aria-labelledby="vis-h">
        <h2 id="vis-h" className="text-lg font-semibold">Visits ({visits.length})</h2>
        {visits.length === 0 && <p className="card text-slate-600">No visits.</p>}
        {visits.map((v, vi) => {
          const rounds = [...cards].filter((r) => r.application_id === v.id);
          const log = [...events].filter((e) => e.application_id === v.id);
          return (
            <article key={v.id} className="card space-y-4" aria-label={`Visit ${v.token}, ${formatDayIST(v.day)}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="font-semibold whitespace-nowrap">
                  {formatDayIST(v.day)} · {v.token}
                </h3>
                <span className="text-slate-700">{v.job}</span>
                <StatusBadge outcome={v.outcome} stage={v.stage} />
                {v.rejectReason && <span className="text-sm text-slate-700">Reason: {v.rejectReason}</span>}
                {v.category && <span className="text-sm text-slate-600">Category: {categoryOf(cats, v.category)!.label}</span>}
              </div>
              <p className="text-sm text-slate-600">
                {[
                  v.decidedAt && `Decided ${formatDateTimeIST(v.decidedAt)}`,
                  v.offerStatus && `Offer ${OFFER_STATUS_LABELS[v.offerStatus].toLowerCase()}${v.offeredCtc !== null ? ` at ${formatLpa(v.offeredCtc)}` : ""}`,
                  v.joiningDate && !v.joinedOn && `joining ${formatDayIST(v.joiningDate)}`,
                  v.joinedOn && `Joined ${formatDayIST(v.joinedOn)}`,
                  v.purgeAfter && `data kept until ${formatDateIST(v.purgeAfter)}`,
                  v.photoPurgeAfter && `photo until ${formatDateIST(v.photoPurgeAfter)}`,
                  v.decidedAt && !v.purgeAfter && v.outcome !== "selected" && v.outcome !== "joined" && "talent pool: no purge date",
                  v.source && `Source: ${v.source}`,
                  v.by && `Registered by ${v.by}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {v.hrNotes && <p className="rounded-lg bg-slate-50 p-3 text-sm whitespace-pre-line">HR notes: {v.hrNotes}</p>}

              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-slate-700">Rounds</h4>
                {rounds.length === 0 && <p className="text-sm text-slate-500">No interview rounds yet.</p>}
                <ol className="space-y-2">
                  {rounds.map((r, i) => (
                    <li key={i} className="rounded-lg border border-slate-200 p-3 text-sm">
                      <p className="font-medium">
                        {r.stage} · {r.interviewer} · {r.decision ? DECISION_LABELS[r.decision] : "—"}
                        {r.reject_reason && ` (${r.reject_reason})`}
                        <span className="font-normal text-slate-500"> · {formatDateTimeIST(new Date(r.updated_at))}</span>
                      </p>
                      <p className="text-slate-700">
                        {Object.entries(r.scores).map(([k, n]) => `${k} ${n}/5`).join(" · ") || "No scores"}
                        {r.overall && ` · overall ${r.overall}/5`}
                      </p>
                      {r.comments && <p className="mt-1 whitespace-pre-line text-slate-600">{r.comments}</p>}
                    </li>
                  ))}
                </ol>
              </div>

              {log.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer font-semibold text-slate-700">Timeline ({log.length})</summary>
                  <ol className="mt-2 space-y-1 border-l-2 border-slate-200 pl-4">
                    {log.map((e, i) => (
                      <li key={i}>
                        <span className="text-slate-500">{formatDateTimeIST(new Date(e.created_at))}</span> · {eventText(e)}
                        {e.note && <span className="text-slate-600"> · {e.note}</span>}
                        {e.actor && <span className="text-slate-500"> · by {e.actor}</span>}
                      </li>
                    ))}
                  </ol>
                </details>
              )}

              {vi === 0 && canResume && v.outcome === "on_hold" && <ResumeButton applicationId={v.id} />}
              {vi === 0 && canOffer && (v.outcome === "selected" || v.outcome === "offer_declined") && (
                <OfferForm
                  applicationId={v.id}
                  offer={{ status: v.offerStatus, offeredCtcLpa: v.offeredCtc === null ? null : rupeesToLpa(v.offeredCtc), joiningDate: v.joiningDate, declineCategory: v.outcome === "offer_declined" ? v.category : null }}
                  categories={categoryOptions(lists)}
                  expectedLpa={expectedLpa}
                  canJoin={v.outcome === "selected" && v.offerStatus !== "declined"}
                  today={todayIST()}
                />
              )}
              {vi === 0 && canOverride && (
                <OverrideForm
                  applicationId={v.id}
                  stages={stageRows}
                  reasons={reasonRows}
                  categories={categoryOptions(lists)}
                  expectedLpa={expectedLpa}
                  offeredLpa={v.offeredCtc === null ? null : rupeesToLpa(v.offeredCtc)}
                />
              )}
            </article>
          );
        })}
      </section>

      {hrOnly && (
        <section className="card space-y-4" aria-labelledby="oo-h">
          <h2 id="oo-h" className="text-lg font-semibold">Other offers in hand</h2>
          {offersElsewhere.length === 0 ? (
            <p className="text-slate-600">None noted.</p>
          ) : (
            <ul className="space-y-1">
              {offersElsewhere.map((o, i) => (
                <li key={o.id} className={i === 0 ? "font-medium" : "text-slate-600"}>
                  {[o.company ?? "Company not given", o.offeredCtc !== null && formatLpa(o.offeredCtc), o.joiningDate && `joining ${formatDayIST(o.joiningDate)}`].filter(Boolean).join(" · ")}
                  <span className="text-sm text-slate-500"> · noted {formatDayIST(o.notedOn)}{o.by ? ` by ${o.by}` : ""}{i === 0 ? " (latest)" : ""}</span>
                </li>
              ))}
            </ul>
          )}
          <details>
            <summary className="cursor-pointer text-blue-700 underline">Add another offer</summary>
            <div className="mt-3">
              <OtherOfferForm candidateId={c.id} today={todayIST()} />
            </div>
          </details>
        </section>
      )}

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
              Open uploaded CV ({u.mimeType === "application/pdf" ? "PDF" : u.mimeType.includes("wordprocessingml") ? "Word, downloads" : "image"})
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
