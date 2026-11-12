// Phase 3.6 part of `npm run smoke` (docs/REDISCOVERY.md): runs inside smoke.ts with its tenants, staff and helpers.
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";

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
  return { costCandidate };
}
