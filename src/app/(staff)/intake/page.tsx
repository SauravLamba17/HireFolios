import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, tenants } from "@/db/schema";
import { uploadRoot } from "@/lib/files";
import { requireStaff } from "@/lib/session";
import { IntakeWizard } from "./intake-wizard";

export const metadata: Metadata = { title: "New candidate" };

// PC intake (webcam): Mobile → Details → Consent → CV → Photo → Save → Token.
export default async function IntakePage() {
  const staff = await requireStaff("intake");
  if (!uploadRoot()) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">New candidate</h1>
        <p role="alert" className="alert-error">
          File storage is not set up on the server: UPLOAD_DIR must be an absolute folder path in the server&apos;s .env. Ask your admin.
        </p>
      </div>
    );
  }
  const [tenant, openJobs] = await Promise.all([
    db.query.tenants.findFirst({ where: eq(tenants.id, staff.tenantId) }),
    db
      .select({ id: jobs.id, title: jobs.title })
      .from(jobs)
      .where(and(eq(jobs.tenantId, staff.tenantId), eq(jobs.status, "open")))
      .orderBy(asc(jobs.title)),
  ]);
  if (!tenant) throw new Error("tenant missing");
  return <IntakeWizard jobs={openJobs} company={tenant.name} photoDays={tenant.photoRetentionDays} dataDays={tenant.dataRetentionDays} />;
}
