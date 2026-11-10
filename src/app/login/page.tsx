import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { brand } from "@/lib/brand";
import { getStaff, homePath } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const staff = await getStaff();
  if (staff) redirect(homePath(staff.role));

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{brand.name}</h1>
          <p className="mt-2 text-slate-600">Sign in with your staff account</p>
        </div>
        <div className="card">
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          No account? Ask your admin to add you.
        </p>
      </div>
    </main>
  );
}
