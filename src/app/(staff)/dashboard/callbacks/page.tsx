import type { Metadata } from "next";
import Link from "next/link";
import { CallbackActions, ContactPanel } from "@/components/contact";
import { RediscoveryTabs } from "@/components/rediscovery-tabs";
import { getCompany } from "@/lib/company";
import { formatDayIST, todayIST } from "@/lib/ist";
import { callbacksDue } from "@/lib/rediscovery/callbacks";
import { coolingWarning, renderTemplates, whatsappAllowed } from "@/lib/rediscovery/contact";
import { contactStates, summaries } from "@/lib/rediscovery/data";
import { getSettings } from "@/lib/rediscovery/settings-db";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Call-backs" };

export default async function CallbacksPage() {
  const staff = await requireStaff("rediscovery");
  const today = todayIST();
  const [rows, settings, company] = await Promise.all([callbacksDue(staff.tenantId, { days: 14 }), getSettings(staff.tenantId), getCompany(staff.tenantId)]);
  const ids = [...new Set(rows.map((r) => r.candidate_id))];
  const [states, sums] = await Promise.all([contactStates(staff.tenantId, ids), summaries(staff.tenantId, ids)]);
  const due = rows.filter((r) => r.due_on <= today);
  const soon = rows.filter((r) => r.due_on > today);

  const item = (r: (typeof rows)[number]) => {
    const st = states.get(r.candidate_id)!;
    const s = sums.get(r.candidate_id)!;
    return (
      <li key={r.id} className="card space-y-3" aria-label={`Call-back: ${r.full_name}`}>
        <p className="flex flex-wrap items-baseline gap-x-3">
          <Link href={`/dashboard/candidates/${r.candidate_id}`} className="text-lg font-semibold text-blue-800 underline">{r.full_name}</Link>
          <span className="text-slate-600">{r.mobile}{r.city ? ` · ${r.city}` : ""}</span>
          <span className={r.due_on <= today ? "font-semibold text-amber-900" : "text-slate-600"}>{r.due_on < today ? "Overdue since" : r.due_on === today ? "Due today," : "Due"} {formatDayIST(r.due_on)}</span>
        </p>
        <p className="text-sm text-slate-700">{s.line}</p>
        {r.note && <p className="text-sm text-slate-600">Note: {r.note}</p>}
        <ContactPanel
          candidateId={r.candidate_id}
          mobile={r.mobile}
          cooling={coolingWarning(st.lastContact, settings.contact_cooling_days)?.text ?? null}
          waAllowed={whatsappAllowed(st.consent)}
          defaultPurpose="callback"
          templates={renderTemplates(settings, { name: r.full_name, company: company.shortName, position: s.latest?.job ?? "", hr_name: staff.name }, "callback")}
        />
        <CallbackActions candidateId={r.candidate_id} callbackId={r.id} today={today} />
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <RediscoveryTabs />
      <div>
        <h1 className="text-2xl font-semibold">Call-backs</h1>
        <p className="mt-1 max-w-3xl text-slate-600">
          People to call back on the date HR set (after a notice-period, timing or shift reason, a hold, or by hand). Oldest first. People who asked not to be
          contacted or withdrew their consent are never listed.
        </p>
      </div>
      <section aria-labelledby="due-h" className="space-y-3">
        <h2 id="due-h" className="text-lg font-semibold">Due now ({due.length})</h2>
        {due.length === 0 ? <p className="card text-slate-600">No call-backs due today.</p> : <ul className="space-y-4">{due.map(item)}</ul>}
      </section>
      <section aria-labelledby="soon-h" className="space-y-3">
        <h2 id="soon-h" className="text-lg font-semibold">Next 14 days ({soon.length})</h2>
        {soon.length === 0 ? <p className="text-slate-600">Nothing planned.</p> : <ul className="space-y-4">{soon.map(item)}</ul>}
      </section>
    </div>
  );
}
