// Phase 3.6 part of `npm run smoke` (docs/REDISCOVERY.md): runs inside smoke.ts with its tenants, staff and helpers.
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { todayIST } from "@/lib/ist";
import { addDays } from "@/lib/rediscovery/contact";
import { planPurge } from "@/lib/purge";

type Call = (p: string, init?: RequestInit) => Promise<Response>;
export type Ctx = {
  check: (name: string, ok: boolean, info?: unknown) => void;
  as: (who: string) => Call;
  tenantA: string;
  tenantB: string;
  panelId: string;
  hrScreenId: string;
  pii: string[];
  candidates: { pool: string; rejected: string };
};

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const patch = (body: unknown): RequestInit => ({ method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export async function rediscoverySmoke(c: Ctx) {
  const { check, as } = c;
  const hr = as("hr"), adm = as("adm"), iv = as("i1"), hrB = as("hrB");

  // ---------- A: reject categories, cost figures, summary, other offers, settings ----------
  const [m2] = await db.select().from(s.applications).where(and(eq(s.applications.tenantId, c.tenantA), eq(s.applications.candidateId, c.candidates.rejected)));
  check("3.6 reject stores the reason's category", m2.rejectCategory === "typing_voice" && m2.costExpectedCtc === null, m2.rejectCategory);

  // a waiting walk-in, rejected for cost with the figures
  const [waiting] = await db
    .select()
    .from(s.applications)
    .where(sql`${s.applications.tenantId} = ${c.tenantA} and ${s.applications.outcome} = 'in_progress' and ${s.applications.panelId} is null`)
    .limit(1);
  let r = await hr("/api/drive", json({ action: "assign", panelId: c.panelId, applicationId: waiting.id }));
  r = await iv("/api/interview", json({ action: "decide", applicationId: waiting.id, scores: { Communication: 4 }, notes: "strong, asks a lot", decision: "reject", rejectReason: "Salary expectation above budget", costExpectedLpa: 4.2, costBudgetLpa: 3 }));
  const [cost] = await db.select().from(s.applications).where(eq(s.applications.id, waiting.id));
  check("3.6 cost rejection stores category + expected / budget in rupees", r.status === 200 && cost.rejectCategory === "cost" && cost.costExpectedCtc === 420000 && cost.costBudgetCtc === 300000, { status: r.status, cost: [cost.rejectCategory, cost.costExpectedCtc, cost.costBudgetCtc] });
  const costCandidate = cost.candidateId;

  r = await hr(`/api/candidates/${costCandidate}/summary`);
  const j = await r.json();
  check("3.6 summary API: not hired for cost, with the gap and the score", r.status === 200 && j.latest.status === "not_hired" && /asked 4\.2 vs budget 3\.0 LPA \(\+40%\)/.test(j.latest.line) && /avg 4\.0\/5/.test(j.latest.line), j.latest?.line);
  r = await iv(`/api/candidates/${costCandidate}/summary`);
  check("3.6 summary API: interviewer of that candidate may read it", r.status === 200, r.status);
  const [never] = await db
    .select({ id: s.candidates.id })
    .from(s.candidates)
    .where(sql`${s.candidates.tenantId} = ${c.tenantA} and not exists (select 1 from queue_events e join applications a on a.id = e.application_id where a.candidate_id = ${s.candidates.id} and e.event = 'called')`)
    .limit(1);
  if (never) check("3.6 summary API: interviewer, never assigned → 404", (await iv(`/api/candidates/${never.id}/summary`)).status === 404);
  check("3.6 summary API: another tenant → 404", (await hrB(`/api/candidates/${costCandidate}/summary`)).status === 404);
  check("3.6 summary API: lobby TV → 404", (await as("tv")(`/api/candidates/${costCandidate}/summary`)).status === 404);

  r = await hr(`/api/candidates/${costCandidate}/rediscovery`, json({ action: "otherOffer", company: "Other Co", offeredCtcLpa: 4, joiningDate: null, notedOn: "2026-01-01" }));
  const offers = await db.select().from(s.otherOffers).where(eq(s.otherOffers.candidateId, costCandidate));
  check("3.6 other offer saved (rupees, noted date)", r.status === 200 && offers.length === 1 && offers[0].offeredCtc === 400000, { status: r.status, offers: offers.length });
  r = await hr(`/api/candidates/${costCandidate}/rediscovery`, json({ action: "otherOffer", company: "", offeredCtcLpa: null, joiningDate: null, notedOn: "2026-01-01" }));
  check("3.6 empty other offer → 400", r.status === 400, r.status);
  r = await hrB(`/api/candidates/${costCandidate}/rediscovery`, json({ action: "otherOffer", company: "X", offeredCtcLpa: null, joiningDate: null, notedOn: "2026-01-01" }));
  check("3.6 other offer on another tenant's candidate → 404", r.status === 404, r.status);
  check("3.6 interviewer can't use rediscovery actions → 403", (await iv(`/api/candidates/${costCandidate}/rediscovery`, json({ action: "otherOffer", company: "X", offeredCtcLpa: null, joiningDate: null, notedOn: "2026-01-01" }))).status === 403);

  check("3.6 HR can't change rediscovery settings → 403", (await hr("/api/settings/rediscovery", patch({ score_threshold: 4 }))).status === 403);
  r = await adm("/api/settings/rediscovery", patch({ score_threshold: 6 }));
  check("3.6 setting outside its limits → 400", r.status === 400, r.status);
  r = await adm("/api/settings/rediscovery", patch({ score_threshold: 3.5, contact_cooling_days: 30 }));
  const rows = await db.select().from(s.tenantSettings).where(eq(s.tenantSettings.tenantId, c.tenantA));
  const thr = rows.find((x) => x.key === "score_threshold");
  check("3.6 admin saves settings: value stored, sample mark cleared", r.status === 200 && thr?.value === 3.5 && thr.sample === false && rows.find((x) => x.key === "bulk_recency_months")?.sample === true, rows.length);
  r = await adm("/dashboard/settings/rediscovery");
  check("3.6 Settings → Rediscovery page loads", r.status === 200 && (await r.text()).includes("Cooling period"), r.status);

  const audits = await db.select().from(s.auditLog).where(eq(s.auditLog.tenantId, c.tenantA));
  check("3.6 audit rows (other offer, settings) hold ids and codes only", audits.some((a) => a.action === "other_offer.add") && audits.some((a) => a.action === "settings.update") && audits.every((a) => !c.pii.some((p) => JSON.stringify(a.meta ?? {}).includes(p))));

  // ---------- B: suggestions, tags, do not rehire ----------
  const red = (p: string, body: unknown) => hr(`/api/candidates/${p}/rediscovery`, json(body));
  r = await hr(`/dashboard/candidates/${costCandidate}`);
  const text = async (res: Response) => (await res.text()).replaceAll("<!-- -->", ""); // React text separators
  let page = await text(r);
  check("3.6 profile shows the suggestion and its reason", page.includes("Suggested tag: Good but high cost") && page.includes("Rejected for Cost: asked 4.2 vs 3.0 LPA (+40%) · avg 4.0 ≥ 3.5"), r.status);
  r = await hr("/dashboard/suggestions");
  page = await r.text();
  check("3.6 suggestions page lists the candidate", r.status === 200 && page.includes(costCandidate), r.status);
  check("3.6 interviewer can't open the suggestions page", (await iv("/dashboard/suggestions")).status === 307);
  r = await red(costCandidate, { action: "suggestionAccept", tag: "high_cost", note: null });
  let tags = await db.select().from(s.candidateTags).where(eq(s.candidateTags.candidateId, costCandidate));
  check("3.6 accept → tag added from the suggestion (reason kept as note)", r.status === 200 && tags.length === 1 && tags[0].tagCode === "high_cost" && tags[0].source === "suggestion" && /asked 4\.2/.test(tags[0].note ?? ""), { status: r.status, tags });
  r = await red(costCandidate, { action: "suggestionAccept", tag: "high_cost", note: null });
  check("3.6 accepting again → 400 (no longer open)", r.status === 400, r.status);
  r = await red(costCandidate, { action: "suggestionDismiss", tag: "near_miss", note: "seat filled anyway" });
  const dis = await db.select().from(s.suggestionDismissals).where(eq(s.suggestionDismissals.candidateId, costCandidate));
  check("3.6 dismiss → remembered for this decision", r.status === 200 && dis.length === 1 && dis[0].applicationId === waiting.id, { status: r.status, dis: dis.length });
  page = await text(await hr(`/dashboard/candidates/${costCandidate}`));
  check("3.6 dismissed suggestion stays away", !page.includes("Suggested tag: Near-miss"));
  check("3.6 suggestions on another tenant's candidate → 404", (await hrB(`/api/candidates/${costCandidate}/rediscovery`, json({ action: "suggestionDismiss", tag: "near_miss", note: null }))).status === 404);

  r = await red(costCandidate, { action: "tagAdd", code: "do_not_rehire", note: "" });
  check("3.6 Do not rehire without a reason → 400", r.status === 400, r.status);
  r = await red(costCandidate, { action: "tagAdd", code: "do_not_rehire", note: "Left without notice last time" });
  check("3.6 Do not rehire with a reason", r.status === 200, await r.clone().json());
  const [cc] = await db.select({ mobile: s.candidates.mobile }).from(s.candidates).where(eq(s.candidates.id, costCandidate));
  const look = await (await hr(`/api/candidates/lookup?mobile=${cc.mobile}`)).json();
  check("3.6 intake lookup carries the HR-only Do not rehire warning", look.doNotRehire?.reason === "Left without notice last time" && look.doNotRehire.by === "Smoke HR", look.doNotRehire);
  page = await text(await hr(`/dashboard/candidates/${costCandidate}`));
  check("3.6 no suggestions for a Do not rehire candidate", !page.includes("Suggested tag:"));
  r = await red(costCandidate, { action: "tagAdd", code: "no_such_tag", note: null });
  check("3.6 unknown tag → 400", r.status === 400, r.status);
  const [undecided] = await db
    .select({ id: s.applications.candidateId })
    .from(s.applications)
    .where(sql`${s.applications.tenantId} = ${c.tenantA} and ${s.applications.candidateId} not in (select candidate_id from applications where decided_at is not null)`)
    .limit(1);
  if (undecided) check("3.6 no tags before a decision → 400", (await red(undecided.id, { action: "tagAdd", code: "reconsider", note: null })).status === 400);
  tags = await db.select().from(s.candidateTags).where(sql`${s.candidateTags.candidateId} = ${costCandidate} and ${s.candidateTags.removedAt} is null`);
  const dnrTag = tags.find((t) => t.tagCode === "do_not_rehire")!;
  r = await red(costCandidate, { action: "tagRemove", tagId: dnrTag.id, note: "" });
  check("3.6 removing a tag needs a note → 400", r.status === 400, r.status);
  r = await red(costCandidate, { action: "tagRemove", tagId: dnrTag.id, note: "Manager agreed to reconsider" });
  const [removed] = await db.select().from(s.candidateTags).where(eq(s.candidateTags.id, dnrTag.id));
  check("3.6 tag removed with the note kept as history", r.status === 200 && removed.removedAt !== null && removed.removeNote === "Manager agreed to reconsider", r.status);
  const look2 = await (await hr(`/api/candidates/lookup?mobile=${cc.mobile}`)).json();
  check("3.6 warning gone after removal", look2.doNotRehire === null, look2.doNotRehire);
  const audits2 = await db.select().from(s.auditLog).where(eq(s.auditLog.tenantId, c.tenantA));
  check(
    "3.6 tag / suggestion actions audited with codes only",
    ["tag.add", "tag.remove", "suggestion.accept", "suggestion.dismiss"].every((a) => audits2.some((x) => x.action === a)) &&
      audits2.every((a) => !c.pii.some((p) => JSON.stringify(a.meta ?? {}).includes(p))),
  );

  // ---------- C: quick-look ----------
  const ql = async (who: Call, q: string) => {
    const res = await who(`/api/quicklook?q=${encodeURIComponent(q)}`);
    return { status: res.status, rows: res.ok ? ((await res.json()).rows as { id: string; name: string; mobile: string; line: string; tags: { code: string }[] }[]) : [] };
  };
  let q = await ql(hr, cc.mobile.slice(-4));
  check("3.6 quick-look by 4 mobile digits finds the candidate with summary and tags", q.status === 200 && q.rows.some((x) => x.id === costCandidate && /Not hired/.test(x.line) && x.tags.some((t) => t.code === "high_cost")), q);
  q = await ql(hr, "Smke Priya"); // typo
  check("3.6 quick-look by a typo'd name", q.rows.some((x) => x.name === "Smoke Priya Sharma"), q.rows.map((x) => x.name));
  check("3.6 quick-look: 1 letter or 3 digits → nothing", (await ql(hr, "S")).rows.length === 0 && (await ql(hr, "123")).rows.length === 0);
  q = await ql(hrB, cc.mobile.slice(-4));
  check("3.6 quick-look never shows another tenant's candidates", q.status === 200 && !q.rows.some((x) => x.id === costCandidate), q.rows.length);
  check("3.6 quick-look: interviewer 403, lobby TV 403", (await iv("/api/quicklook?q=Smoke")).status === 403 && (await as("tv")("/api/quicklook?q=Smoke")).status === 403);

  // ---------- D: contact log, cooling, call-backs, do not contact, consent ----------
  const today = todayIST();
  r = await red(costCandidate, { action: "contact", channel: "whatsapp", purpose: "other", outcome: null, note: null });
  check("3.6 WhatsApp without WhatsApp consent → 400 (call only)", r.status === 400, r.status);
  r = await red(costCandidate, { action: "contact", channel: "call", purpose: "callback", outcome: "no_answer", note: "rang twice" });
  check("3.6 call logged", r.status === 200 && (await db.$count(s.contactLog, eq(s.contactLog.candidateId, costCandidate))) === 1, r.status);
  page = await text(await hr(`/dashboard/candidates/${costCandidate}`));
  check("3.6 profile shows the cooling warning and Call only", page.includes("Contacted today by Smoke HR — contact again?") && page.includes("Call only (no WhatsApp consent)"));
  r = await red(costCandidate, { action: "callbackSet", dueOn: addDays(today, -1), note: null });
  check("3.6 call-back in the past → 400", r.status === 400, r.status);
  r = await red(costCandidate, { action: "callbackSet", dueOn: today, note: "after notice" });
  const [cb] = await db.select().from(s.callbacks).where(eq(s.callbacks.candidateId, costCandidate));
  check("3.6 call-back set (today)", r.status === 200 && cb?.dueOn === today && cb.status === "open", r.status);
  page = await text(await hr("/dashboard/callbacks"));
  check("3.6 call-backs page lists it as due", page.includes("Due now (1)") && page.includes(costCandidate));
  check("3.6 dashboard card shows call-backs due", (await text(await hr("/dashboard"))).includes("Call-backs due: 1"));
  q = await ql(hr, cc.mobile.slice(-4));
  check("3.6 quick-look shows Due for call-back", q.rows.some((x) => x.id === costCandidate && (x as { callbackDue?: string }).callbackDue === today), q.rows[0]);
  r = await red(costCandidate, { action: "callbackSnooze", callbackId: cb.id, dueOn: addDays(today, 3), note: null });
  check("3.6 snooze moves it out of today's list", r.status === 200 && (await text(await hr("/dashboard/callbacks"))).includes("Due now (0)"), r.status);
  r = await red(costCandidate, { action: "callbackDone", callbackId: cb.id, outcome: "interested", note: "comes Monday" });
  const [cbDone] = await db.select().from(s.callbacks).where(eq(s.callbacks.id, cb.id));
  check("3.6 call-back done with outcome", r.status === 200 && cbDone.status === "done" && cbDone.outcome === "interested", cbDone.status);
  check("3.6 done twice → 400", (await red(costCandidate, { action: "callbackDone", callbackId: cb.id, outcome: "interested", note: null })).status === 400);

  r = await red(costCandidate, { action: "callbackSet", dueOn: today, note: null });
  r = await red(costCandidate, { action: "dncSet", reason: "Asked us not to call again" });
  check("3.6 Do not contact set", r.status === 200, r.status);
  check("3.6 Do not contact: contact refused", (await red(costCandidate, { action: "contact", channel: "call", purpose: "other", outcome: null, note: null })).status === 400);
  check("3.6 Do not contact: call-back refused and hidden from the list", (await red(costCandidate, { action: "callbackSet", dueOn: today, note: null })).status === 400 && (await text(await hr("/dashboard/callbacks"))).includes("Due now (0)"));
  page = await text(await hr(`/dashboard/candidates/${costCandidate}`));
  check("3.6 profile: Do not contact shown, no Call / WhatsApp buttons", page.includes("Asked us not to call again") && !page.includes(">Call<") && !page.includes("Call only"));
  check("3.6 HR can't clear Do not contact → 403", (await red(costCandidate, { action: "dncClear", note: "they called us" })).status === 403);
  r = await adm(`/api/candidates/${costCandidate}/rediscovery`, json({ action: "dncClear", note: "They called us back and asked for jobs" }));
  check("3.6 admin clears Do not contact with a note", r.status === 200, r.status);

  // consent after the visit → kept past retention; withdrawal → normal dates from the withdrawal day
  const rej = c.candidates.rejected;
  const visitsBefore = await db.select().from(s.applications).where(eq(s.applications.candidateId, rej));
  r = await red(rej, { action: "consentRecord", day: today, channel: "phone", note: "said yes on the phone", whatsapp: true });
  const visitsKept = await db.select().from(s.applications).where(eq(s.applications.candidateId, rej));
  check("3.6 consent recorded: not-hired visits lose their deletion dates", r.status === 200 && visitsBefore.some((v) => v.purgeAfter) && visitsKept.filter((v) => v.outcome === "rejected").every((v) => v.purgeAfter === null), r.status);
  const later = (days: number) => planPurge(new Date(Date.now() + days * 864e5), c.tenantA).then((p) => p[0]?.candidates ?? []);
  check("3.6 kept past retention (dry run in 400 days: not deleted)", !(await later(400)).includes(rej));
  check("3.6 deleted after the 24-month keep period (dry run in 25 months)", (await later(25 * 31)).includes(rej) || visitsKept.some((v) => ["in_progress", "on_hold", "selected"].includes(v.outcome)));
  r = await red(rej, { action: "consentWithdraw", day: today });
  const after = await db.select().from(s.applications).where(eq(s.applications.candidateId, rej));
  const days = (d: Date | null) => (d ? Math.round((d.getTime() - Date.now()) / 864e5) : null);
  check("3.6 withdrawal restarts the deletion dates from today (365 / 180 days)", r.status === 200 && after.filter((v) => v.outcome === "rejected").every((v) => days(v.purgeAfter) === 365 && days(v.photoPurgeAfter) === 180), after.map((v) => days(v.purgeAfter)));
  check("3.6 withdrawing twice → 400", (await red(rej, { action: "consentWithdraw", day: today })).status === 400);
  const audits3 = await db.select().from(s.auditLog).where(eq(s.auditLog.tenantId, c.tenantA));
  check(
    "3.6 contact / call-back / consent / do-not-contact audited with codes only",
    ["contact.log", "callback.set", "callback.snooze", "callback.done", "contact.block", "contact.unblock", "consent.record", "consent.withdraw"].every((a) => audits3.some((x) => x.action === a)) &&
      audits3.every((a) => !c.pii.some((p) => JSON.stringify(a.meta ?? {}).includes(p)) && !/rang|Monday|phone/.test(JSON.stringify(a.meta ?? {}).replace('"phone"', ""))),
  );
  return { costCandidate };
}
