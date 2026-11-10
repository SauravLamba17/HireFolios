import type { Metadata } from "next";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobs, locations } from "@/db/schema";
import { requireStaff } from "@/lib/session";
import { SettingsManager } from "./settings-manager";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const staff = await requireStaff("settings");
  const [jobRows, locationRows] = await Promise.all([
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
  ]);
  return <SettingsManager jobs={jobRows} locations={locationRows} />;
}
