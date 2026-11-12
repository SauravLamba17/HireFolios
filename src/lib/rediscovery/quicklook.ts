// Header quick-look (docs/REDISCOVERY.md C1): up to 8 candidates of this tenant for 2+ letters of a name or 4+ digits
// of a mobile, typo-tolerant, index-backed. HR-only data (tags, summary) is added for these few rows only.
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { normalizeMobile } from "@/lib/intake";
import { experienceLabel } from "@/lib/options";
import { insights } from "@/lib/rediscovery/data";

export const QUICKLOOK_LIMIT = 8;
// word_similarity ≥ 0.4 lets one or two typos through (same as the candidate list).
const SIMILARITY = "0.4";

export type QuickLookRow = {
  id: string;
  name: string;
  mobile: string;
  city: string | null;
  photoId: string | null;
  lastJob: string | null;
  lastVisit: string | null; // IST day
  visits: number;
  profile: string; // qualification · certifications · experience
  line: string;
  change: string | null;
  tags: { code: string; label: string }[];
  callbackDue: string | null; // filled by sub-phase D
};

/** What the box was given: a name, a mobile part, or too little to search. */
export function quickMode(q: string): { kind: "name"; text: string } | { kind: "mobile"; digits: string } | null {
  const t = q.trim();
  const digits = t.replace(/[\s\-+()]/g, "");
  if (/^\d+$/.test(digits)) return digits.length >= 4 ? { kind: "mobile", digits: normalizeMobile(digits) ?? digits.replace(/^(91|0)(?=\d{10}$)/, "") } : null;
  return t.replace(/[^\p{L}]/gu, "").length >= 2 ? { kind: "name", text: t.slice(0, 60) } : null;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export async function quickLook(tenantId: string, q: string): Promise<QuickLookRow[]> {
  const mode = quickMode(q);
  if (!mode) return [];
  const matches = await db.transaction(async (tx) => {
    // `<%` (word similarity) and `like` both use the trigram indexes on full_name / mobile
    await tx.execute(sql`select set_config('pg_trgm.word_similarity_threshold', ${SIMILARITY}, true)`);
    const where =
      mode.kind === "mobile"
        ? sql`c.mobile like ${`%${escapeLike(mode.digits)}%`}`
        : sql`(${mode.text} <% c.full_name or c.full_name ilike ${`%${escapeLike(mode.text)}%`})`;
    const rank = mode.kind === "mobile" ? sql`0.0::real` : sql`word_similarity(${mode.text}, c.full_name)`;
    return tx.execute<{ id: string; full_name: string; mobile: string; city: string | null; qualification: string | null; certifications: string[]; experience_months: number | null }>(sql`
      select c.id, c.full_name, c.mobile, c.city, c.qualification, c.certifications, c.experience_months
      from candidates c
      left join lateral (select max(a.token_date) as last from applications a where a.tenant_id = c.tenant_id and a.candidate_id = c.id) lv on true
      where c.tenant_id = ${tenantId} and ${where}
      order by ${rank} desc, lv.last desc nulls last, c.created_at desc
      limit ${QUICKLOOK_LIMIT}`);
  });
  const ids = [...matches].map((m) => m.id);
  if (!ids.length) return [];
  const idList = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const [extra, photos, info] = await Promise.all([
    db.execute<{ candidate_id: string; job: string; day: string; n: number }>(sql`
      select distinct on (a.candidate_id) a.candidate_id, j.title as job, a.token_date::text as day, count(*) over (partition by a.candidate_id)::int as n
      from applications a join jobs j on j.id = a.job_id
      where a.tenant_id = ${tenantId} and a.candidate_id in (${idList})
      order by a.candidate_id, a.token_date desc, a.created_at desc`),
    db.execute<{ candidate_id: string; id: string }>(sql`
      select distinct on (f.candidate_id) f.candidate_id, f.id from candidate_files f
      where f.tenant_id = ${tenantId} and f.candidate_id in (${idList}) and f.kind = 'photo' and f.deleted_at is null
      order by f.candidate_id, f.created_at desc`),
    insights(tenantId, ids),
  ]);
  const last = new Map([...extra].map((e) => [e.candidate_id, e]));
  const photo = new Map([...photos].map((p) => [p.candidate_id, p.id]));
  return [...matches].map((m) => {
    const s = info.get(m.id)!;
    const l = last.get(m.id);
    return {
      id: m.id,
      name: m.full_name,
      mobile: m.mobile,
      city: m.city,
      photoId: photo.get(m.id) ?? null,
      lastJob: l?.job ?? null,
      lastVisit: l?.day ?? null,
      visits: l?.n ?? 0,
      profile: [m.qualification, m.certifications.join(", "), experienceLabel(m.experience_months)].filter(Boolean).join(" · "),
      line: s.latest?.line ?? "No visits",
      change: s.change?.text ?? null,
      tags: s.tags.map((t) => ({ code: t.code, label: t.label })),
      callbackDue: null,
    };
  });
}
