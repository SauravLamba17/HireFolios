// Rediscovery pool and bulk hiring lists (docs/REDISCOVERY.md E). One base query per tenant gives each candidate's
// flags (tags, do not rehire / contact, consent, open visit, retention); the pure rules (summary, trend, rank) do the rest.
import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { todayIST } from "@/lib/ist";
import { lpaToRupees } from "@/lib/money";
import { getOptionLists } from "@/lib/lists-db";
import { CAT, TAG } from "@/lib/rediscovery/categories";
import { categoryMap, summaries, tagLabels } from "@/lib/rediscovery/data";
import type { Category } from "@/lib/rediscovery/categories";
import { byRank, overBudget, rank, type BulkCriteria, type Ranked } from "@/lib/rediscovery/rank";
import { getSettings } from "@/lib/rediscovery/settings-db";
import { rankWeights } from "@/lib/rediscovery/settings";
import { scoreChange, type ScoreChange } from "@/lib/rediscovery/trend";

export const POOL_PAGE = 25;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const num = (max: number) => z.coerce.number().min(0).max(max).optional().catch(undefined);
const label = z.string().trim().min(1).max(100).optional().catch(undefined);
const yes = z.literal("yes").optional().catch(undefined);

// Pool filters from the URL; bad values are dropped, never a 500.
export const PoolFilters = z.object({
  tag: z.string().trim().min(1).max(40).optional().catch(undefined),
  job: z.uuid().optional().catch(undefined),
  cert: label,
  ehr: label,
  expMin: num(45),
  expMax: num(45),
  ctcMin: num(100),
  ctcMax: num(100),
  scoreMin: num(5),
  scoreMax: num(5),
  change: z.enum(["up", "down"]).optional().catch(undefined),
  from: day.optional().catch(undefined),
  to: day.optional().catch(undefined),
  consent: z.enum(["pool", "none"]).optional().catch(undefined),
  due: yes,
  contacted: z.coerce.number().int().min(1).max(365).optional().catch(undefined),
  dnc: yes,
  sort: z.enum(["score", "change", "visit", "ctc"]).catch("score"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type PoolFilter = z.output<typeof PoolFilters>;
export const parsePool = (params: Record<string, string | string[] | undefined>) =>
  PoolFilters.parse(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));

type BaseRow = {
  id: string;
  full_name: string;
  mobile: string;
  city: string | null;
  qualification: string | null;
  experience_months: number | null;
  expected_ctc: number | null;
  certifications: string[];
  ehr_software: string[];
  night_shift_ok: boolean | null;
  voice_process: boolean | null;
  last_visit: string;
  tags: string[];
  dnc: boolean;
  joined: boolean;
  active: boolean;
  on_hold: boolean;
  in_pool: boolean;
  withdrawn: boolean;
  past_retention: boolean;
  last_contact: string | null;
  callback_due: string | null;
  job_ids: string[];
  ld_outcome: string | null; // latest decided visit (bulk sources)
  ld_category: string | null;
};

/** Candidates of one tenant with their flags; `where` adds conditions on f (one row per candidate). Set-based: each
 * table is read once per tenant (10,000 candidates in a few hundred ms), never once per candidate. */
export async function baseRows(tenantId: string, where: SQL[]): Promise<BaseRow[]> {
  const today = todayIST();
  return [
    ...(await db.execute<BaseRow>(sql`
      with v as (
        select a.candidate_id, max(a.token_date) as last_visit,
               bool_or(a.outcome = 'joined') as joined,
               bool_or(a.outcome in ('in_progress', 'selected')) as active,
               bool_or(a.outcome = 'on_hold') as on_hold,
               bool_and(a.purge_after is not null and a.purge_after < now()) as past_retention,
               array_agg(distinct a.job_id) as job_ids
        from applications a where a.tenant_id = ${tenantId} group by a.candidate_id
      ), ld as (
        select distinct on (d.candidate_id) d.candidate_id, d.outcome as ld_outcome, d.reject_category as ld_category
        from applications d
        where d.tenant_id = ${tenantId} and d.decided_at is not null
          and d.outcome in ('selected', 'joined', 'rejected', 'no_show', 'withdrawn', 'offer_declined')
        order by d.candidate_id, d.decided_at desc
      ), lk as (
        select distinct on (k.candidate_id) k.candidate_id, k.talent_pool, k.withdrawn_at
        from consents k where k.tenant_id = ${tenantId} order by k.candidate_id, k.accepted_at desc
      ), tg as (
        select t.candidate_id, array_agg(t.tag_code) as tags from candidate_tags t where t.tenant_id = ${tenantId} and t.removed_at is null group by t.candidate_id
      ), dn as (
        select distinct d.candidate_id from do_not_contact d where d.tenant_id = ${tenantId} and d.cleared_at is null
      ), lc as (
        select l.candidate_id, max(l.contacted_at) as last_contact from contact_log l where l.tenant_id = ${tenantId} group by l.candidate_id
      ), cb as (
        select b.candidate_id, min(b.due_on) as due from callbacks b where b.tenant_id = ${tenantId} and b.status = 'open' and b.due_on <= ${today}::date group by b.candidate_id
      )
      select * from (
        select c.id, c.full_name, c.mobile, c.city, c.qualification, c.experience_months, c.expected_ctc, c.certifications, c.ehr_software,
          c.night_shift_ok, c.voice_process,
          v.last_visit::text as last_visit, v.joined, v.active, v.on_hold, v.past_retention, v.job_ids,
          coalesce(tg.tags, '{}') as tags,
          dn.candidate_id is not null as dnc,
          coalesce(lk.talent_pool and lk.withdrawn_at is null, false) as in_pool,
          coalesce(lk.withdrawn_at is not null, false) as withdrawn,
          lc.last_contact::text as last_contact,
          cb.due::text as callback_due,
          ld.ld_outcome, ld.ld_category
        from candidates c
        join v on v.candidate_id = c.id
        left join ld on ld.candidate_id = c.id
        left join lk on lk.candidate_id = c.id
        left join tg on tg.candidate_id = c.id
        left join dn on dn.candidate_id = c.id
        left join lc on lc.candidate_id = c.id
        left join cb on cb.candidate_id = c.id
        where c.tenant_id = ${tenantId}
      ) f
      where ${where.length ? sql.join(where, sql` and `) : sql`true`}`)),
  ];
}

export type PoolRow = BaseRow & { avg: number | null; change: ScoreChange | null; line: string; tagLabels: string[]; lastJob: string | null };

const SORTS: Record<PoolFilter["sort"], (a: PoolRow, b: PoolRow) => number> = {
  score: (a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.last_visit.localeCompare(a.last_visit),
  change: (a, b) => (b.change?.delta ?? -99) - (a.change?.delta ?? -99) || b.last_visit.localeCompare(a.last_visit),
  visit: (a, b) => b.last_visit.localeCompare(a.last_visit),
  ctc: (a, b) => (a.expected_ctc ?? Infinity) - (b.expected_ctc ?? Infinity) || b.last_visit.localeCompare(a.last_visit),
};

/** The pool: everyone with a rediscovery tag (Do not rehire only when asked for), never people who withdrew consent. */
export async function searchPool(tenantId: string, f: PoolFilter, opts: { all?: boolean } = {}) {
  const w: SQL[] = [sql`not f.withdrawn`];
  w.push(f.tag ? sql`${f.tag} = any(f.tags)` : sql`exists (select 1 from unnest(f.tags) t where t <> ${TAG.doNotRehire})`);
  if (!f.dnc) w.push(sql`not f.dnc`);
  if (f.job) w.push(sql`${f.job}::uuid = any(f.job_ids)`);
  if (f.cert) w.push(sql`${f.cert} = any(f.certifications)`);
  if (f.ehr) w.push(sql`${f.ehr} = any(f.ehr_software)`);
  if (f.expMin !== undefined) w.push(sql`coalesce(f.experience_months, 0) >= ${Math.round(f.expMin * 12)}`);
  if (f.expMax !== undefined) w.push(sql`coalesce(f.experience_months, 0) <= ${Math.round(f.expMax * 12)}`);
  if (f.ctcMin !== undefined) w.push(sql`f.expected_ctc >= ${lpaToRupees(f.ctcMin)}`);
  if (f.ctcMax !== undefined) w.push(sql`f.expected_ctc <= ${lpaToRupees(f.ctcMax)}`);
  if (f.from) w.push(sql`f.last_visit >= ${f.from}`);
  if (f.to) w.push(sql`f.last_visit <= ${f.to}`);
  if (f.consent === "pool") w.push(sql`f.in_pool`);
  if (f.consent === "none") w.push(sql`not f.in_pool`);
  if (f.due) w.push(sql`f.callback_due is not null`);
  if (f.contacted) w.push(sql`f.last_contact::timestamptz >= now() - make_interval(days => ${f.contacted})`);
  const base = await baseRows(tenantId, w);
  const lists = await getOptionLists(tenantId);
  const labels = tagLabels(lists);
  const sums = await summaries(tenantId, base.map((b) => b.id), lists);
  let rows: PoolRow[] = base.map((b) => {
    const s = sums.get(b.id)!;
    const scored = s.visits.find((v) => v.avg !== null);
    return { ...b, avg: scored?.avg ?? null, change: scoreChange(s.visits), line: s.line, tagLabels: b.tags.map((t) => labels.get(t) ?? t), lastJob: s.latest?.job ?? null };
  });
  if (f.scoreMin !== undefined) rows = rows.filter((r) => r.avg !== null && r.avg >= f.scoreMin!);
  if (f.scoreMax !== undefined) rows = rows.filter((r) => r.avg !== null && r.avg <= f.scoreMax!);
  if (f.change) rows = rows.filter((r) => r.change?.dir === f.change);
  rows.sort(SORTS[f.sort]);
  const total = rows.length;
  return { total, rows: opts.all ? rows : rows.slice((f.page - 1) * POOL_PAGE, f.page * POOL_PAGE) };
}

// ---------- bulk hiring ----------

const ids = z.preprocess((v) => (Array.isArray(v) ? v : v === undefined || v === "" ? [] : [v]), z.array(z.string()));
export const BulkForm = z.object({
  jobs: ids.pipe(z.array(z.uuid())).catch([]),
  needed: z.coerce.number().int().min(1).max(500).catch(10),
  budget: z.coerce.number().min(0.1).max(100).optional().catch(undefined), // LPA
  cert: ids.pipe(z.array(z.string().trim().min(1).max(100))).catch([]),
  ehr: ids.pipe(z.array(z.string().trim().min(1).max(100))).catch([]),
  minExp: z.coerce.number().min(0).max(45).optional().catch(undefined), // years
  night: yes,
  voice: yes,
});
export type BulkInput = z.output<typeof BulkForm>;
export const parseBulk = (params: Record<string, string | string[] | undefined>) => BulkForm.parse(params);
/** The criteria back as URL parameters (links to the export and back to the list). */
export function bulkQuery(b: BulkInput) {
  const p = new URLSearchParams();
  for (const j of b.jobs) p.append("jobs", j);
  p.set("needed", String(b.needed));
  if (b.budget !== undefined) p.set("budget", String(b.budget));
  for (const c of b.cert) p.append("cert", c);
  for (const e of b.ehr) p.append("ehr", e);
  if (b.minExp !== undefined) p.set("minExp", String(b.minExp));
  if (b.night) p.set("night", "yes");
  if (b.voice) p.set("voice", "yes");
  return p.toString();
}
export const bulkCriteria = (b: BulkInput): BulkCriteria => ({
  budget: b.budget === undefined ? null : lpaToRupees(b.budget),
  certifications: b.cert,
  software: b.ehr,
  minExperienceMonths: b.minExp === undefined ? null : Math.round(b.minExp * 12),
  night: b.night === "yes",
  voice: b.voice === "yes",
});

export const EXCLUSIONS = {
  dnr: "Do not rehire",
  dnc: "Do not contact",
  withdrawn: "Consent withdrawn",
  joined: "Joined (employees)",
  active: "In an active visit",
  retention: "Past retention, no talent-pool consent",
  overBudget: "Too far over budget",
} as const;
export type Exclusion = keyof typeof EXCLUSIONS;

export type BulkRow = BaseRow & { ranked: Ranked; avg: number | null; lastVisitDay: string; line: string; tagLabels: string[]; source: string };

/** Why this person is a source for bulk hiring (null: not a source). Uses the latest decision only (no summary needed). */
function sourceOf(b: BaseRow, cats: Map<string, Category>, labels: Map<string, string>): string | null {
  const cat = b.ld_category ? cats.get(b.ld_category) : undefined;
  if (b.ld_outcome === "rejected" && b.ld_category === CAT.cost) return "Cost reject";
  if (b.ld_outcome === "offer_declined") return "Offer declined";
  if (b.ld_outcome === "rejected" && cat?.kind === "non_skill") return `Near-miss (${cat.label})`;
  if (b.on_hold) return "On hold";
  const tag = b.tags.find((t) => t !== TAG.doNotRehire);
  if (tag) return `Tagged: ${labels.get(tag) ?? tag}`;
  if (b.in_pool) return "Talent pool";
  return null;
}

export async function bulkList(tenantId: string, input: BulkInput) {
  const settings = await getSettings(tenantId);
  const lists = await getOptionLists(tenantId);
  const labels = tagLabels(lists);
  const k = bulkCriteria(input);
  const today = todayIST();
  const w: SQL[] = [sql`f.last_visit::date >= (${today}::date - make_interval(months => ${settings.bulk_recency_months}))::date`];
  if (input.jobs.length) w.push(sql`f.job_ids && array[${sql.join(input.jobs.map((j) => sql`${j}::uuid`), sql`, `)}]`);
  const base = await baseRows(tenantId, w);
  const cats = categoryMap(lists);
  const excluded: Record<Exclusion, number> = { dnr: 0, dnc: 0, withdrawn: 0, joined: 0, active: 0, retention: 0, overBudget: 0 };
  // sources and exclusions first (cheap), then summaries only for the people who stay on the list
  const kept: (BaseRow & { source: string })[] = [];
  for (const b of base) {
    const source = sourceOf(b, cats, labels);
    if (!source) continue; // not a rediscovery source (e.g. rejected for skills): simply not on the list
    const why: Exclusion | null = b.tags.includes(TAG.doNotRehire)
      ? "dnr"
      : b.dnc
        ? "dnc"
        : b.withdrawn
          ? "withdrawn"
          : b.joined
            ? "joined"
            : b.active
              ? "active"
              : b.past_retention && !b.in_pool
                ? "retention"
                : null;
    if (why) {
      excluded[why]++;
      continue;
    }
    const over = overBudget(b.expected_ctc, k.budget);
    if (over !== null && over > settings.bulk_over_budget_percent) {
      excluded.overBudget++;
      continue;
    }
    kept.push({ ...b, source });
  }
  const sums = await summaries(tenantId, kept.map((b) => b.id), lists);
  const rows: BulkRow[] = [];
  for (const b of kept) {
    const s = sums.get(b.id)!;
    const source = b.source;
    const scored = s.visits.find((v) => v.avg !== null);
    const change = scoreChange(s.visits);
    const ranked = rank(
      { expectedCtc: b.expected_ctc, avg: scored?.avg ?? null, delta: change?.delta ?? null, certifications: b.certifications, software: b.ehr_software, experienceMonths: b.experience_months, nightShiftOk: b.night_shift_ok, voiceProcess: b.voice_process, lastVisitDay: b.last_visit, source },
      k,
      rankWeights(settings),
      { today, recencyMonths: settings.bulk_recency_months, overBudgetLimit: settings.bulk_over_budget_percent },
    );
    rows.push({ ...b, ranked, avg: scored?.avg ?? null, lastVisitDay: b.last_visit, line: s.line, tagLabels: b.tags.map((t) => labels.get(t) ?? t), source });
  }
  rows.sort(byRank);
  return { rows, excluded, weights: rankWeights(settings), settings };
}

/** Pushes each candidate is already in (warn "already in push X"). */
export async function pushesOf(tenantId: string, candidateIds: string[]) {
  const out = new Map<string, { id: string; name: string; status: string }[]>();
  if (!candidateIds.length) return out;
  const rows = await db.execute<{ candidate_id: string; id: string; name: string; status: string }>(sql`
    select m.candidate_id, p.id, p.name, m.status from push_members m join hiring_pushes p on p.id = m.push_id
    where m.tenant_id = ${tenantId} and m.candidate_id in (${sql.join(candidateIds.map((i) => sql`${i}::uuid`), sql`, `)})
    order by p.created_at desc`);
  for (const r of rows) out.set(r.candidate_id, [...(out.get(r.candidate_id) ?? []), { id: r.id, name: r.name, status: r.status }]);
  return out;
}
