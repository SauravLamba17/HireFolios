import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaff, homePath } from "@/lib/session";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Change password" };

// The one page a staff member with a temporary password may open.
export default async function PasswordPage() {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{staff.mustChangePassword ? "Choose a new password" : "Change password"}</h1>
        <p className="mt-1 text-slate-600 break-all">{staff.email}</p>
      </div>
      {staff.mustChangePassword && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You signed in with a temporary password from your admin. Choose your own password to continue.
        </p>
      )}
      <div className="card">
        <PasswordForm forced={staff.mustChangePassword} next={homePath(staff.role)} />
      </div>
    </div>
  );
}
