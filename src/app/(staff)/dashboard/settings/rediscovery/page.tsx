import type { Metadata } from "next";
import { getSettingsWithSample } from "@/lib/rediscovery/settings-db";
import { requireStaff } from "@/lib/session";
import { RediscoverySettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Rediscovery settings" };

export default async function RediscoverySettingsPage() {
  const staff = await requireStaff("settings");
  const { values, sample } = await getSettingsWithSample(staff.tenantId);
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
      <RediscoverySettingsForm values={values} sample={sample} />
    </div>
  );
}
