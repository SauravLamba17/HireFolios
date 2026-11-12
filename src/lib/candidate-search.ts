// Candidate list search: filters come from the URL, every query is scoped to the staff member's tenant.
import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { outcomeEnum } from "@/db/schema";
import { normalizeMobile } from "@/lib/intake";

export const PAGE_SIZE = 25;
// word_similarity(query, full_name): 1 = query is a whole word of the name. 0.4 lets one or two typos through.
// ponytail: called as a function, so the trigram index isn't used (a scan per search). Fine for tens of
// thousands of candidates per tenant; past that, switch to the `<%` operator with pg_trgm.word_similarity_threshold.
const NAME_SIMILARITY = 0.4;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const yes = z.literal("yes").optional().catch(undefined);

// Bad or stale URL values are dropped rather than failing the page.
export const CandidateFilters = z.object({
  q: z.string().trim().max(100).catch(""),
  job: z.uuid().optional().catch(undefined),
  status: z.enum(outcomeEnum.enumValues).optional().catch(undefined),
  from: day.optional().catch(undefined),
  to: day.optional().catch(undefined),
  // labels from the tenant's lists (Settings → Lists); an unknown label just finds nobody
  cert: z.string().trim().min(1).max(100).optional().catch(undefined),
  ehr: z.string().trim().min(1).max(100).optional().catch(undefined),
  night: yes,
  voice: yes,
  pool: yes,
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type Filters = z.output<typeof CandidateFilters>;

export function parseFilters(params: Record<string, string | string[] | undefined>): Filters {
  const first = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  return CandidateFilters.parse({ q: "", ...first });
}

/** Text the full-text index covers. Called on every candidate save. */
export function searchTextFor(c: {
  fullName: string;
  city: string | null;
  qualification: string | null;
  skills: string | null;
  languages: string[];
  certifications: string[];
  codingSpecialties: string[];
  ehrSoftware: string[];
}) {
  return [c.fullName, c.city, c.qualification, c.skills, ...c.languages, ...c.certifications, ...c.codingSpecialties, ...c.ehrSoftware]
    .filter(Boolean)
    .join(" ");
}

/** "epic cpc" → "epic:* & cpc:*" (prefix match on every word). Letters and digits only, so it can't break tsquery syntax. */
export function prefixQuery(q: string) {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  return words ? words.map((w) => `${w}:*`).join(" & ") : null;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

type SearchMode = { kind: "none" } | { kind: "mobile"; digits: string } | { kind: "email"; text: string } | { kind: "text"; text: string; ts: string | null };

export function searchMode(q: string): SearchMode {
  if (!q) return { kind: "none" };
  const digits = q.replace(/[\s\-+()]/g, "");
  if (/^\d{4,}$/.test(digits)) return { kind: "mobile", digits: normalizeMobile(digits) ?? digits };
  if (q.includes("@")) return { kind: "email", text: q.toLowerCase() };
  return { kind: "text", text: q, ts: prefixQuery(q) };
}

/**
 * WHERE clause for the list query below. Aliases: c = candidates, la = latest visit, lk = latest consent.
 * The tenant filter is always first and always present.
 */
export function candidateWhere(f: Filters, tenantId: string): SQL {
  const where: SQL[] = [sql`c.tenant_id = ${tenantId}`];
  const mode = searchMode(f.q);
  if (mode.kind === "mobile") where.push(sql`c.mobile like ${`%${mode.digits}%`}`);
  if (mode.kind === "email") where.push(sql`c.email like ${`%${escapeLike(mode.text)}%`}`);
  if (mode.kind === "text") {
    const fts = mode.ts ? sql`to_tsvector('simple', c.search_text) @@ to_tsquery('simple', ${mode.ts})` : sql`false`;
    where.push(sql`(word_similarity(${mode.text}, c.full_name) >= ${NAME_SIMILARITY} or ${fts})`);
  }

  // Position and date range apply to the same visit.
  const visit: SQL[] = [];
  if (f.job) visit.push(sql`a.job_id = ${f.job}`);
  if (f.from) visit.push(sql`a.token_date >= ${f.from}`);
  if (f.to) visit.push(sql`a.token_date <= ${f.to}`);
  if (visit.length) {
    where.push(sql`exists (select 1 from applications a where a.tenant_id = c.tenant_id and a.candidate_id = c.id and ${sql.join(visit, sql` and `)})`);
  }
  if (f.status) where.push(sql`la.outcome = ${f.status}`);
  if (f.cert) where.push(sql`${f.cert} = any(c.certifications)`);
  if (f.ehr) where.push(sql`${f.ehr} = any(c.ehr_software)`);
  if (f.night) where.push(sql`c.night_shift_ok`);
  if (f.voice) where.push(sql`c.voice_process`);
  if (f.pool) where.push(sql`lk.talent_pool and lk.withdrawn_at is null`);
  return sql.join(where, sql` and `);
}

/** ORDER BY: best text match first (only when there is text to match), then the latest visit. */
export function orderBy(f: Filters): SQL {
  const recent = sql`la.token_date desc nulls last, c.created_at desc`;
  const mode = searchMode(f.q);
  if (mode.kind !== "text") return recent;
  const ts = mode.ts ? sql`ts_rank(to_tsvector('simple', c.search_text), to_tsquery('simple', ${mode.ts}))` : sql`0.0`;
  return sql`greatest(word_similarity(${mode.text}, c.full_name), ${ts}) desc, ${recent}`;
}

export type CandidateRow = {
  id: string;
  full_name: string;
  mobile: string;
  email: string | null;
  city: string | null;
  experience_months: number | null;
  expected_ctc: number | null;
  certifications: string[];
  ehr_software: string[];
  night_shift_ok: boolean | null;
  voice_process: boolean | null;
  token: string | null;
  token_date: string | null;
  outcome: string | null;
  job: string | null;
  stage: string | null;
  talent_pool: boolean;
  photo_id: string | null;
  total: number;
};

/** One page of the list, or (`all`) every match for an export, capped at EXPORT_MAX rows. */
export const EXPORT_MAX = 10_000;
export async function searchCandidates(f: Filters, tenantId: string, opts: { all?: boolean } = {}) {
  const rows = await db.execute<CandidateRow>(sql`
    select c.id, c.full_name, c.mobile, c.email, c.city, c.experience_months, c.expected_ctc, c.certifications, c.ehr_software,
           c.night_shift_ok, c.voice_process,
           la.token, la.token_date::text as token_date, la.outcome, j.title as job, s.name as stage,
           coalesce(lk.talent_pool and lk.withdrawn_at is null, false) as talent_pool,
           ph.id as photo_id, count(*) over ()::int as total
    from candidates c
    left join lateral (
      select a.token, a.token_date, a.outcome, a.job_id, a.current_stage_id from applications a
      where a.tenant_id = c.tenant_id and a.candidate_id = c.id
      order by a.token_date desc, a.created_at desc limit 1
    ) la on true
    left join jobs j on j.id = la.job_id
    left join stages s on s.id = la.current_stage_id
    left join lateral (
      select k.talent_pool, k.withdrawn_at from consents k
      where k.tenant_id = c.tenant_id and k.candidate_id = c.id
      order by k.accepted_at desc limit 1
    ) lk on true
    left join lateral (
      select f.id from candidate_files f
      where f.tenant_id = c.tenant_id and f.candidate_id = c.id and f.kind = 'photo' and f.deleted_at is null
      order by f.created_at desc limit 1
    ) ph on true
    where ${candidateWhere(f, tenantId)}
    order by ${orderBy(f)}
    limit ${opts.all ? EXPORT_MAX : PAGE_SIZE} offset ${opts.all ? 0 : (f.page - 1) * PAGE_SIZE}
  `);
  return { rows: [...rows], total: rows[0]?.total ?? 0 };
}
