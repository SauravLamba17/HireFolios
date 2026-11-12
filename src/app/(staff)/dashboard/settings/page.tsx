import type { Metadata } from "next";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, jobs, locations, rejectReasons, stages, tenants } from "@/db/schema";
import { formatDateTimeIST } from "@/lib/ist";
import { activeLabels } from "@/lib/lists";
import { getOptionLists } from "@/lib/lists-db";
import { planPurge } from "@/lib/purge";
import { requireStaff } from "@/lib/session";
import { DriveSettings } from "./drive-settings";
import { RetentionSettings } from "./retention-settings";
import { SettingsManager } from "./settings-manager";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const staff = await requireStaff("settings");
  const [jobRows, locationRows, stageRows, reasonRows, [tenant], [lastRun], preview, lists] = await Promise.all([
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
    db.select({ avg: tenants.avgInterviewMinutes, cooldown: tenants.cooldownDays, photo: tenants.photoRetentionDays, data: tenants.dataRetentionDays }).from(tenants).where(eq(tenants.id, staff.tenantId)),
    db
      .select({ at: auditLog.createdAt })
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, staff.tenantId), eq(auditLog.action, "retention.purge")))
      .orderBy(desc(auditLog.createdAt))
      .limit(1),
    // Dry run: what the deletion job would remove if it ran 7 days from now.
    planPurge(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), staff.tenantId),
    getOptionLists(staff.tenantId),
  ]);
  return (
    <div className="space-y-8">
      <SettingsManager jobs={jobRows} locations={locationRows} certifications={activeLabels(lists, "certification")} />
      <DriveSettings stages={stageRows} reasons={reasonRows} avgMinutes={tenant?.avg ?? null} />
      <RetentionSettings
        cooldownDays={tenant.cooldown}
        photoRetentionDays={tenant.photo}
        dataRetentionDays={tenant.data}
        preview={{ photos: preview[0]?.photos.length ?? 0, candidates: preview[0]?.candidates.length ?? 0 }}
        lastRun={lastRun ? formatDateTimeIST(lastRun.at) : null}
      />
    </div>
  );
}
