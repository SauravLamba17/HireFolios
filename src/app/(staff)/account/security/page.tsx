import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaff, homePath, PASSWORD_PAGE, twoFactorRequired } from "@/lib/session";
import { SecurityPanel } from "./security-panel";

export const metadata: Metadata = { title: "Sign-in security" };

// Two-factor sign-in (authenticator app) and "sign out everywhere". Staff whose role must use two-factor
// (TWO_FACTOR_REQUIRED_ROLES) are sent here until it is set up.
export default async function SecurityPage() {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.mustChangePassword) redirect(PASSWORD_PAGE);
  const required = twoFactorRequired(staff.role);
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sign-in security</h1>
        <p className="mt-1 break-all text-slate-600">{staff.email}</p>
      </div>
      {required && !staff.twoFactorEnabled && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Your role must use two-factor sign-in. Set it up below to continue.
        </p>
      )}
      <SecurityPanel enabled={staff.twoFactorEnabled} required={required} next={homePath(staff.role)} />
    </div>
  );
}
