import type { Metadata } from "next";
import { requireStaff } from "@/lib/session";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Change password" };

export default async function PasswordPage() {
  const staff = await requireStaff();
  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Change password</h1>
        <p className="mt-1 text-slate-600 break-all">{staff.email}</p>
      </div>
      <div className="card">
        <PasswordForm />
      </div>
    </div>
  );
}
