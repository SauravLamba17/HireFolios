// Call-backs due (docs/REDISCOVERY.md D5): open call-backs of this tenant, never for people who asked not to be
// contacted or withdrew their consent.
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { todayIST } from "@/lib/ist";

const blocked = sql`(exists (select 1 from do_not_contact d where d.candidate_id = b.candidate_id and d.cleared_at is null)
  or coalesce((select k.withdrawn_at is not null from consents k where k.candidate_id = b.candidate_id order by k.accepted_at desc limit 1), false))`;

export type CallbackRow = { id: string; candidate_id: string; due_on: string; note: string | null; full_name: string; mobile: string; city: string | null };

/** Due (date reached) or, with `days`, also the next N days. Oldest first. */
export async function callbacksDue(tenantId: string, opts: { days?: number } = {}) {
  const until = opts.days ? sql`(${todayIST()}::date + ${opts.days}::int)` : sql`${todayIST()}::date`;
  return [
    ...(await db.execute<CallbackRow>(sql`
      select b.id, b.candidate_id, b.due_on::text, b.note, c.full_name, c.mobile, c.city
      from callbacks b join candidates c on c.id = b.candidate_id
      where b.tenant_id = ${tenantId} and b.status = 'open' and b.due_on <= ${until} and not ${blocked}
      order by b.due_on, b.created_at`)),
  ];
}

export async function callbacksDueCount(tenantId: string) {
  const [r] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from callbacks b
    where b.tenant_id = ${tenantId} and b.status = 'open' and b.due_on <= ${todayIST()}::date and not ${blocked}`);
  return r?.n ?? 0;
}
