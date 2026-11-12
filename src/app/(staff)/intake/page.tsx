import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, tenants } from "@/db/schema";
import { getCompany } from "@/lib/company";
import { uploadLimits } from "@/lib/config";
import { uploadRoot } from "@/lib/files";
import { getOptionLists } from "@/lib/lists-db";
import { getActiveNotice } from "@/lib/notice-db";
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
  const [tenant, openJobs, lists, notice, company] = await Promise.all([
    db.query.tenants.findFirst({ where: eq(tenants.id, staff.tenantId) }),
    db
      .select({ id: jobs.id, title: jobs.title })
      .from(jobs)
      .where(and(eq(jobs.tenantId, staff.tenantId), eq(jobs.status, "open")))
      .orderBy(asc(jobs.title)),
    getOptionLists(staff.tenantId),
    getActiveNotice(staff.tenantId),
    getCompany(staff.tenantId),
  ]);
  if (!tenant) throw new Error("tenant missing");
  return (
    <IntakeWizard
      jobs={openJobs}
      company={company.name}
      photoDays={tenant.photoRetentionDays}
      dataDays={tenant.dataRetentionDays}
      lists={lists}
      notice={{ version: notice.version, texts: notice.texts, contact: { name: notice.contactName, email: notice.contactEmail, phone: notice.contactPhone } }}
      limits={uploadLimits()}
    />
  );
}
