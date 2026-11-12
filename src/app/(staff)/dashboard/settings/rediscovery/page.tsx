import type { Metadata } from "next";
import Link from "next/link";
import { formatDateIST } from "@/lib/ist";
import { poolExpiring } from "@/lib/rediscovery/data";
import { getSettingsWithSample } from "@/lib/rediscovery/settings-db";
import { requireStaff } from "@/lib/session";
import { RediscoverySettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Rediscovery settings" };

export default async function RediscoverySettingsPage() {
  const staff = await requireStaff("settings");
  const [{ values, sample }, expiring] = await Promise.all([getSettingsWithSample(staff.tenantId), poolExpiring(staff.tenantId, 30)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Rediscovery</h1>
        <p className="mt-1 max-w-3xl text-slate-600">
          Rules for finding past candidates again: when a score counts as strong, how often HR may contact someone, how long
          talent-pool candidates are kept, joining-risk hints, bulk lists and WhatsApp messages. Every suggestion and hint only
          helps HR decide; nothing here changes a candidate&apos;s result by itself.
        </p>
        {Object.keys(sample).length > 0 && (
          <p className="mt-3 max-w-3xl rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
            Values marked <strong>Sample</strong> are starting values. Check them with your HR team, then save each section.
          </p>
        )}
      </div>
      <section className="card space-y-2" aria-labelledby="exp-h">
        <h2 id="exp-h" className="text-lg font-semibold">Talent pool: expiring in the next 30 days: {expiring.length}</h2>
        <p className="text-sm text-slate-600">
          Dry run, nothing is deleted here. Talent-pool candidates are kept {values.talent_pool_keep_months} months after their last visit or consent renewal; the
          deletion job removes them after that unless HR records consent again (profile → Renew consent).
        </p>
        {expiring.length > 0 && (
          <ul className="list-disc pl-6 text-sm" aria-label="Expiring talent-pool candidates">
            {expiring.map((e) => (
              <li key={e.id}>
                <Link href={`/dashboard/candidates/${e.id}`} className="text-blue-700 underline">{e.name}</Link> · until {formatDateIST(e.until)}
              </li>
            ))}
          </ul>
        )}
      </section>
      <RediscoverySettingsForm values={values} sample={sample} />
    </div>
  );
}
