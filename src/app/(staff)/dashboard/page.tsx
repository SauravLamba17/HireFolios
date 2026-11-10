import type { Metadata } from "next";
import Link from "next/link";
import { can, ROLE_LABELS, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const staff = await requireStaff("dashboard");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="card space-y-2">
        <p className="text-lg">
          Signed in as <strong>{staff.name}</strong> ({ROLE_LABELS[staff.role]}).
        </p>
        <p className="text-slate-600">The walk-in queue, interviews and reports will appear here in later phases.</p>
      </div>
      {can(staff.role, "users") && (
        <Link href="/dashboard/users" className="btn btn-primary">
          Manage staff accounts
        </Link>
      )}
    </div>
  );
}
