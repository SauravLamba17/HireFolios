import type { Metadata } from "next";
import { headers } from "next/headers";
import { config } from "@/lib/config";
import { clientIp } from "@/lib/net";
import { getAllowList } from "@/lib/security-settings";
import { requireStaff, twoFactorRequired } from "@/lib/session";
import { AllowListForm } from "./allow-list-form";

export const metadata: Metadata = { title: "Security settings" };

export default async function SecuritySettingsPage() {
  const staff = await requireStaff("settings");
  const [list, h] = await Promise.all([getAllowList(staff.tenantId), headers()]);
  const c = config();
  const required = (["admin", "hr", "manager", "interviewer"] as const).filter((r) => twoFactorRequired(r));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Security</h1>
        <p className="mt-1 max-w-3xl text-slate-600">Who may sign in, and from where. Two-factor sign-in, wrong-password lockout and sign-in limits are set in the server&apos;s settings file.</p>
      </div>
      <section className="card space-y-2" aria-labelledby="srv-h">
        <h2 id="srv-h" className="text-lg font-semibold">Server settings (read only)</h2>
        <ul className="list-disc pl-6 text-sm text-slate-700">
          <li>Two-factor sign-in required for: {required.length ? required.join(", ") : "nobody (optional for everyone)"} (TWO_FACTOR_REQUIRED_ROLES)</li>
          <li>
            Account locked for {c.LOCKOUT_MINUTES} minutes after {c.LOCKOUT_ATTEMPTS} wrong passwords in a row (LOCKOUT_ATTEMPTS, LOCKOUT_MINUTES); unlock early in Staff
          </li>
          <li>Sign-in attempts per internet address: {c.SIGN_IN_LIMIT.replace("/", " per ")} seconds (SIGN_IN_LIMIT)</li>
          {c.IP_ALLOWLIST_OFF === "1" && <li className="font-medium text-red-800">IP_ALLOWLIST_OFF=1: the allow-list below is ignored (emergency switch)</li>}
        </ul>
      </section>
      <AllowListForm on={list.on} entries={list.entries} mine={clientIp(h)} />
    </div>
  );
}
