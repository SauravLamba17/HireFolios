// Loads what the pure rediscovery rules need (visits, scorecards, categories), always within one tenant.
import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { applications, jobs, optionItems, rejectReasons, stages } from "@/db/schema";
import type { OfferStatus, Outcome } from "@/lib/flow";
import type { OptionLists } from "@/lib/lists";
import { getOptionLists } from "@/lib/lists-db";
import { CAT, isCategoryKind, type Category, type CategoryOption, type ReasonOption } from "@/lib/rediscovery/categories";
import { summarize, type CardInput, type CandidateSummary, type VisitInput } from "@/lib/rediscovery/summary";

type Q = typeof db | Tx;

/** code → category (retired items included: old decisions keep their category). */
export function categoryMap(lists: OptionLists) {
  return new Map<string, Category>(
    lists.reject_category.filter((i) => i.code).map((i) => [i.code!, { code: i.code!, label: i.label, kind: isCategoryKind(i.kind) ? i.kind : "neutral" }]),
  );
}
export const categoryOf = (map: Map<string, Category>, code: string | null): Category | null =>
  code === null ? null : (map.get(code) ?? { code, label: code === CAT.other ? "Other" : code, kind: "neutral" });

/** code → tag label (retired included). */
export const tagLabels = (lists: OptionLists) => new Map(lists.rediscovery_tag.filter((i) => i.code).map((i) => [i.code!, i.label]));

/** Active reject reasons with their category, for the reject forms. */
export async function reasonOptions(tenantId: string): Promise<ReasonOption[]> {
  const [rows, lists] = await Promise.all([
    db
      .select({ label: rejectReasons.label, code: rejectReasons.categoryCode })
      .from(rejectReasons)
      .where(and(eq(rejectReasons.tenantId, tenantId), eq(rejectReasons.active, true)))
      .orderBy(asc(rejectReasons.position)),
    getOptionLists(tenantId),
  ]);
  const cats = categoryMap(lists);
  return rows.map((r) => {
    const c = categoryOf(cats, r.code ?? CAT.other)!;
    return { label: r.label, category: c.label, isCost: c.code === CAT.cost };
  });
}

/** Active categories (for a declined offer). */
export const categoryOptions = (lists: OptionLists): CategoryOption[] =>
  lists.reject_category.filter((i) => i.active && i.code).map((i) => ({ code: i.code!, label: i.label }));

/** Category code of an active reject reason, or null if the reason is not on the list. */
export async function reasonCategory(q: Q, tenantId: string, label: string) {
  const [r] = await q
    .select({ code: rejectReasons.categoryCode })
    .from(rejectReasons)
    .where(and(eq(rejectReasons.tenantId, tenantId), eq(rejectReasons.label, label), eq(rejectReasons.active, true)));
  return r ? (r.code ?? CAT.other) : null;
}

/** True when `code` is an active category of this tenant. */
export async function isActiveCategory(q: Q, tenantId: string, code: string) {
  const [r] = await q
    .select({ id: optionItems.id })
    .from(optionItems)
    .where(and(eq(optionItems.tenantId, tenantId), eq(optionItems.list, "reject_category"), eq(optionItems.code, code), eq(optionItems.active, true)));
  return Boolean(r);
}

export type History = { visits: VisitInput[]; cards: CardInput[] };

/** Visits and scorecards of these candidates (one tenant), ready for summarize(). */
export async function loadHistories(tenantId: string, candidateIds: string[], lists?: OptionLists): Promise<Map<string, History>> {
  const out = new Map<string, History>(candidateIds.map((id) => [id, { visits: [], cards: [] }]));
  if (!candidateIds.length) return out;
  const cats = categoryMap(lists ?? (await getOptionLists(tenantId)));
  const [visits, cards] = await Promise.all([
    db
      .select({
        candidateId: applications.candidateId,
        id: applications.id,
        day: applications.tokenDate,
        createdAt: applications.createdAt,
        job: jobs.title,
        outcome: applications.outcome,
        stage: stages.name,
        rejectReason: applications.rejectReason,
        category: applications.rejectCategory,
        costExpected: applications.costExpectedCtc,
        costBudget: applications.costBudgetCtc,
        decidedAt: applications.decidedAt,
        offerStatus: applications.offerStatus,
        offeredCtc: applications.offeredCtc,
        joiningDate: applications.joiningDate,
        joinedOn: applications.joinedOn,
      })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .innerJoin(stages, eq(stages.id, applications.currentStageId))
      .where(and(eq(applications.tenantId, tenantId), inArray(applications.candidateId, candidateIds))),
    db.execute<{ candidate_id: string; application_id: string; stage_id: string; stage_name: string; stage_position: number; interviewer: string | null; scores: Record<string, number>; overall: number | null; comments: string | null; at: string }>(sql`
      select a.candidate_id, sc.application_id, sc.stage_id, s.name as stage_name, s.position as stage_position, u.name as interviewer,
             sc.scores, sc.overall, sc.comments, sc.updated_at as at
      from scorecards sc
      join applications a on a.id = sc.application_id
      join stages s on s.id = sc.stage_id
      left join users u on u.id = sc.interviewer_id
      where a.tenant_id = ${tenantId} and sc.tenant_id = ${tenantId} and a.candidate_id in ${sql`(${sql.join(candidateIds.map((i) => sql`${i}::uuid`), sql`, `)})`}`),
  ]);
  for (const v of visits) {
    out.get(v.candidateId)!.visits.push({
      ...v,
      outcome: v.outcome as Outcome,
      offerStatus: v.offerStatus as OfferStatus | null,
      category: categoryOf(cats, v.category),
    });
  }
  for (const c of cards) {
    out.get(c.candidate_id)?.cards.push({
      applicationId: c.application_id,
      stageId: c.stage_id,
      stageName: c.stage_name,
      stagePosition: c.stage_position,
      interviewer: c.interviewer,
      scores: c.scores ?? {},
      overall: c.overall,
      comments: c.comments,
      at: new Date(c.at),
    });
  }
  return out;
}

export async function summaries(tenantId: string, candidateIds: string[], lists?: OptionLists): Promise<Map<string, CandidateSummary & { history: History }>> {
  const h = await loadHistories(tenantId, candidateIds, lists);
  return new Map([...h].map(([id, x]) => [id, { ...summarize(x.visits, x.cards), history: x }]));
}

/** Id of the last active interview round (by position), or null. */
export async function lastInterviewStageId(tenantId: string) {
  const [s] = await db
    .select({ id: stages.id })
    .from(stages)
    .where(and(eq(stages.tenantId, tenantId), eq(stages.active, true), eq(stages.isInterview, true)))
    .orderBy(sql`${stages.position} desc`)
    .limit(1);
  return s?.id ?? null;
}
