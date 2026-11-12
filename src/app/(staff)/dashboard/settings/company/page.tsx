import type { Metadata } from "next";
import { getCompany, SUPPORTED_TIME_ZONES } from "@/lib/company";
import { requireStaff } from "@/lib/session";
import { CompanyForm } from "./company-form";

export const metadata: Metadata = { title: "Company" };

export default async function CompanyPage() {
  const staff = await requireStaff("settings");
  const c = await getCompany(staff.tenantId);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Company</h1>
        <p className="mt-1 max-w-3xl text-slate-600">
          How your company appears in the header, on the lobby TV, in the privacy notice and in exports. The token prefix starts each day&apos;s
          numbers (for example A-001); a change applies to the next token.
        </p>
        {c.sample && (
          <p className="mt-3 max-w-3xl rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
            These are starting values. Check them and press <strong>Save</strong> once.
          </p>
        )}
      </div>
      <CompanyForm
        company={{ name: c.name, shortName: c.shortName === c.name ? "" : c.shortName, tokenPrefix: c.tokenPrefix, officeAddress: c.officeAddress ?? "", timeZone: c.timeZone }}
        logoUrl={c.logoUrl}
        timeZones={[...SUPPORTED_TIME_ZONES]}
      />
    </div>
  );
}
