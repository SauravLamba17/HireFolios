import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { RediscoveryTabs } from "@/components/rediscovery-tabs";
import { SuggestionCard } from "@/components/rediscovery";
import { formatDateTimeIST } from "@/lib/ist";
import { insights } from "@/lib/rediscovery/data";
import { getSettings } from "@/lib/rediscovery/settings-db";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Suggestions to review" };

// ponytail: rules run on the 300 most recently decided candidates; enough for a walk-in office (a few hundred
// decisions a month). Page through older decisions if a tenant ever needs more.
const LOOK_AT = 300;

export default async function SuggestionsPage() {
  const staff = await requireStaff("rediscovery");
  const settings = await getSettings(staff.tenantId);
  // Candidates whose latest decision is a rejection or a declined offer, with scores, never joined, decided recently.
  const rows = await db.execute<{ id: string; full_name: string; mobile: string; city: string | null }>(sql`
    select c.id, c.full_name, c.mobile, c.city
    from candidates c
    join lateral (
      select a.id, a.outcome, a.decided_at from applications a
      where a.tenant_id = c.tenant_id and a.candidate_id = c.id and a.decided_at is not null
        and a.outcome in ('selected', 'joined', 'rejected', 'no_show', 'withdrawn', 'offer_declined')
      order by a.decided_at desc limit 1
    ) ld on true
    where c.tenant_id = ${staff.tenantId}
      and ld.outcome in ('rejected', 'offer_declined')
      and ld.decided_at >= now() - make_interval(months => ${settings.bulk_recency_months})
      and not exists (select 1 from applications j where j.tenant_id = c.tenant_id and j.candidate_id = c.id and j.outcome = 'joined')
      and exists (select 1 from scorecards sc where sc.tenant_id = c.tenant_id and sc.application_id = ld.id)
    order by ld.decided_at desc
    limit ${LOOK_AT}`);
  const people = new Map([...rows].map((r) => [r.id, r]));
  const found = await insights(staff.tenantId, [...people.keys()]);
  const list = [...found.entries()]
    .flatMap(([id, s]) => s.suggestions.map((g) => ({ ...g, person: people.get(id)!, line: s.line })))
    .sort((a, b) => b.decidedAt.getTime() - a.decidedAt.getTime());

  return (
    <div className="space-y-6">
      <RediscoveryTabs />
      <div>
        <h1 className="text-2xl font-semibold">Suggestions to review</h1>
        <p className="mt-1 max-w-3xl text-slate-600">
          Strong people we did not hire for a reason that was not about their skills (cost, timing, shift, a filled seat, a declined
          offer). Nothing is tagged until you accept. A dismissed suggestion comes back only after a new decision for that person.
          Strong score: {settings.score_threshold} of 5 or more (Settings → Rediscovery).
        </p>
      </div>
      {list.length === 0 ? (
        <p className="card text-slate-600">No suggestions to review right now.</p>
      ) : (
        <ul className="space-y-4" aria-label="Suggestions">
          {list.map((g) => (
            <li key={`${g.person.id}-${g.tag}`} className="card space-y-2">
              <p className="flex flex-wrap items-baseline gap-x-3">
                <Link href={`/dashboard/candidates/${g.person.id}`} className="text-lg font-semibold text-blue-800 underline">{g.person.full_name}</Link>
                <span className="text-slate-600">{g.person.mobile}{g.person.city ? ` · ${g.person.city}` : ""}</span>
                <span className="text-sm text-slate-500">decided {formatDateTimeIST(g.decidedAt)}</span>
              </p>
              <p className="text-sm text-slate-700">{g.line}</p>
              <SuggestionCard candidateId={g.person.id} tag={g.tag} label={g.label} reason={g.reason} name={g.person.full_name} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
