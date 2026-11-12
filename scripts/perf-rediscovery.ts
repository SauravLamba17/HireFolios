// Phase 3.6 performance check (docs/REDISCOVERY.md): 10,000 sample candidates in a throwaway tenant, timings of the
// quick-look, pool and bulk queries, EXPLAIN of the quick-look, then the tenant is deleted. Dev / test databases only.
//   npx tsx --conditions=react-server --env-file=.env scripts/perf-rediscovery.ts
import { sql } from "drizzle-orm";
import { db, pgClient } from "@/db";
import * as s from "@/db/schema";
import { quickLook } from "@/lib/rediscovery/quicklook";

const N = Number(process.env.PERF_CANDIDATES ?? 10_000);
const RUN = Date.now().toString(36);
const NAMES = ["Priya", "Rahul", "Anita", "Suresh", "Kavita", "Amit", "Neha", "Rohit", "Pooja", "Vikram", "Seema", "Arjun", "Divya", "Manoj", "Ritu", "Sanjay"];
const SURNAMES = ["Sharma", "Verma", "Singh", "Gupta", "Kaur", "Mehta", "Bansal", "Arora", "Malhotra", "Chopra", "Joshi", "Rana"];

async function time<T>(label: string, fn: () => Promise<T>, runs = 5) {
  await fn(); // warm
  const ms: number[] = [];
  let out: T | undefined;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    out = await fn();
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  console.log(`${label.padEnd(48)} median ${ms[Math.floor(ms.length / 2)].toFixed(0)} ms  (max ${ms[ms.length - 1].toFixed(0)} ms)`);
  return out!;
}

export async function seedPerfTenant() {
  const [t] = await db.insert(s.tenants).values({ name: "Perf tenant", slug: `perf-${RUN}`, tokenPrefix: "P" }).returning();
  const [loc] = await db.insert(s.locations).values({ tenantId: t.id, name: "Perf office" }).returning();
  const st = await db
    .insert(s.stages)
    .values([
      { tenantId: t.id, name: "Registered", position: 1 },
      { tenantId: t.id, name: "HR screen", position: 2, isInterview: true, criteria: [{ label: "Communication", required: false }] },
      { tenantId: t.id, name: "Manager round", position: 3, isInterview: true, criteria: [{ label: "Communication", required: false }] },
    ])
    .returning();
  const jobs = await db.insert(s.jobs).values(["AR Caller", "Medical Coder", "Payment Poster"].map((title) => ({ tenantId: t.id, title }))).returning();
  const [u] = await db.insert(s.users).values({ id: crypto.randomUUID(), name: "Perf HR", email: `perf-${RUN}@perf.example.test`, role: "hr", tenantId: t.id }).returning();
  // candidates and 1–3 visits each, rejected / no-show / selected mix, scorecards on most visits, some tags
  await db.execute(sql`
    insert into candidates (tenant_id, full_name, mobile, city, qualification, experience_months, expected_ctc, notice_days, certifications, ehr_software, night_shift_ok, voice_process, search_text)
    select ${t.id}, n.name, (7000000000 + g)::text, (array['Mohali','Zirakpur','Chandigarh','Panchkula'])[1 + g % 4], 'B.Com', g % 72,
           250000 + (g % 30) * 10000, (array[0,15,30,60,90])[1 + g % 5], case when g % 3 = 0 then array['CPC'] else '{}' end,
           case when g % 2 = 0 then array['Epic'] else '{}' end, g % 2 = 0, g % 3 = 0, n.name
    from generate_series(1, ${N}) g
    cross join lateral (select (${sql.raw(`array[${NAMES.map((x) => `'${x}'`).join(",")}]`)})[1 + g % ${NAMES.length}] || ' ' ||
                               (${sql.raw(`array[${SURNAMES.map((x) => `'${x}'`).join(",")}]`)})[1 + (g / ${NAMES.length})::int % ${SURNAMES.length}] || ' ' || g as name) n`);
  await db.execute(sql`
    insert into applications (tenant_id, candidate_id, job_id, location_id, token, token_date, current_stage_id, outcome, reject_reason, reject_category,
                              client_request_id, created_at, decided_at, purge_after, photo_purge_after, cost_expected_ctc, cost_budget_ctc)
    select ${t.id}, c.id, (array[${sql.raw(jobs.map((j) => `'${j.id}'::uuid`).join(","))}])[1 + v % 3], ${loc.id}, 'P-' || c.mobile || '-' || v, (current_date - (v * 97 + c.mobile::bigint % 600)::int % 700),
           ${st[1].id}, o.outcome::application_outcome, case when o.outcome = 'rejected' then 'Sample reason' end, o.cat,
           gen_random_uuid(), now() - make_interval(days => (v * 97 + c.mobile::bigint % 600)::int % 700), now() - make_interval(days => (v * 97 + c.mobile::bigint % 600)::int % 700),
           now() + interval '200 days', now() + interval '100 days',
           case when o.cat = 'cost' then c.expected_ctc end, case when o.cat = 'cost' then 300000 end
    from candidates c
    cross join generate_series(1, 1 + (c.mobile::bigint % 3)::int) v
    cross join lateral (select (array['rejected','rejected','rejected','no_show','selected','offer_declined'])[1 + (c.mobile::bigint + v) % 6] as outcome,
                               (array['cost','knowledge','notice_timing','seat_filled','communication'])[1 + (c.mobile::bigint + v) % 5] as cat) o
    where c.tenant_id = ${t.id}`);
  await db.execute(sql`update applications set reject_category = case when outcome = 'no_show' then 'no_show' when outcome in ('rejected','offer_declined') then reject_category end where tenant_id = ${t.id}`);
  await db.execute(sql`
    insert into scorecards (tenant_id, application_id, stage_id, interviewer_id, scores, overall, decision)
    select ${t.id}, a.id, ${st[1].id}, ${u.id}, jsonb_build_object('Communication', 1 + (a.candidate_id::text ~ '^[0-7]')::int * 2 + (length(a.token) % 3)), 3, 'reject'
    from applications a where a.tenant_id = ${t.id} and a.outcome <> 'no_show'`);
  await db.execute(sql`
    insert into candidate_tags (tenant_id, candidate_id, tag_code, source, added_by)
    select ${t.id}, c.id, (array['high_cost','near_miss','reconsider'])[1 + c.mobile::bigint % 3], 'manual', ${u.id}
    from candidates c where c.tenant_id = ${t.id} and c.mobile::bigint % 4 = 0`);
  await db.execute(sql`analyze candidates; analyze applications; analyze scorecards; analyze candidate_tags`);
  const counts = await db.execute<{ c: number; a: number; t: number }>(sql`select (select count(*) from candidates where tenant_id = ${t.id})::int c,
    (select count(*) from applications where tenant_id = ${t.id})::int a, (select count(*) from candidate_tags where tenant_id = ${t.id})::int t`);
  console.log(`perf tenant: ${counts[0].c} candidates, ${counts[0].a} visits, ${counts[0].t} tags`);
  return { tenantId: t.id, userId: u.id };
}

async function dropPerfTenant(tenantId: string) {
  for (const t of [s.scorecards, s.queueEvents, s.consents, s.candidateFiles]) await db.delete(t).where(sql`tenant_id = ${tenantId}`);
  await db.delete(s.applications).where(sql`tenant_id = ${tenantId}`);
  for (const t of [s.candidates, s.auditLog, s.optionItems, s.users, s.jobs, s.stages, s.locations]) await db.delete(t).where(sql`tenant_id = ${tenantId}`);
  await db.delete(s.tenants).where(sql`id = ${tenantId}`);
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Never on a production database.");
  const { tenantId } = await seedPerfTenant();
  try {
    await time("quick-look: name with a typo (Kavta Sharma)", () => quickLook(tenantId, "Kavta Sharma"));
    await time("quick-look: 2 letters (pr)", () => quickLook(tenantId, "pr"));
    await time("quick-look: 4 mobile digits (1234)", () => quickLook(tenantId, "1234"));
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('pg_trgm.word_similarity_threshold', '0.4', true)`);
      return tx.execute<{ "QUERY PLAN": string }>(sql`explain analyze select c.id from candidates c where c.tenant_id = ${tenantId} and ('Kavta Sharma' <% c.full_name or c.full_name ilike '%Kavta Sharma%') limit 8`);
    });
    console.log("EXPLAIN quick-look (name):\n  " + [...plan].map((r) => r["QUERY PLAN"]).join("\n  "));
    const plan2 = await db.execute<{ "QUERY PLAN": string }>(sql`explain analyze select c.id from candidates c where c.tenant_id = ${tenantId} and c.mobile like '%1234%' limit 8`);
    console.log("EXPLAIN quick-look (mobile):\n  " + [...plan2].map((r) => r["QUERY PLAN"]).join("\n  "));
  } finally {
    await dropPerfTenant(tenantId);
    console.log("perf tenant deleted");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
