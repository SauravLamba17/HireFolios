import type { Metadata } from "next";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobs, locations, rejectReasons, stages, tenants } from "@/db/schema";
import { requireStaff } from "@/lib/session";
import { DriveSettings } from "./drive-settings";
import { SettingsManager } from "./settings-manager";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const staff = await requireStaff("settings");
  const [jobRows, locationRows, stageRows, reasonRows, [tenant]] = await Promise.all([
    db
      .select({
        id: jobs.id,
        title: jobs.title,
        status: jobs.status,
        openings: jobs.openings,
        minExperienceYears: jobs.minExperienceYears,
        maxExperienceYears: jobs.maxExperienceYears,
        requiredCertifications: jobs.requiredCertifications,
        sample: jobs.sample,
      })
      .from(jobs)
      .where(eq(jobs.tenantId, staff.tenantId))
      // open first, then paused, then closed; alphabetical within each
      .orderBy(sql`array_position(array['open','paused','closed']::job_status[], ${jobs.status})`, asc(jobs.title)),
    db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(eq(locations.tenantId, staff.tenantId))
      .orderBy(asc(locations.createdAt)),
    db
      .select({ id: stages.id, name: stages.name, active: stages.active, isInterview: stages.isInterview, criteria: stages.criteria, sample: stages.sample })
      .from(stages)
      .where(eq(stages.tenantId, staff.tenantId))
      .orderBy(asc(stages.position)),
    db
      .select({ id: rejectReasons.id, label: rejectReasons.label, active: rejectReasons.active, sample: rejectReasons.sample })
      .from(rejectReasons)
      .where(eq(rejectReasons.tenantId, staff.tenantId))
      .orderBy(asc(rejectReasons.position)),
    db.select({ avg: tenants.avgInterviewMinutes }).from(tenants).where(eq(tenants.id, staff.tenantId)),
  ]);
  return (
    <div className="space-y-8">
      <SettingsManager jobs={jobRows} locations={locationRows} />
      <DriveSettings stages={stageRows} reasons={reasonRows} avgMinutes={tenant?.avg ?? null} />
    </div>
  );
}
