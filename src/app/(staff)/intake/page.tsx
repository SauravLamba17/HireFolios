import type { Metadata } from "next";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Intake" };

// Placeholder so HR has a home page. The tablet intake flow is Phase 1.
export default async function IntakePage() {
  await requireStaff("intake");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Walk-in intake</h1>
      <div className="card">
        <p className="text-slate-600">Registering walk-in candidates on the tablet arrives in the next phase.</p>
      </div>
    </div>
  );
}
