// Demo data, on request only. Never runs by itself and is not part of a release (npm run package ships no scripts/).
//   npm run demo:seed    a separate "demo" tenant (its own lists, notice, jobs) with 12 sample candidates, all
//                        named "Sample candidate NN", and a demo admin to look at them: DEMO_ADMIN_EMAIL (default
//                        demo-admin@demo.example.test) with the password you put in .env as DEMO_ADMIN_PASSWORD.
//   npm run demo:clear   removes that tenant and everything in it (rows and files).
// It never touches any other tenant. Refuses to run when NODE_ENV=production.
import fs from "node:fs";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db, pgClient } from "@/db";
import * as s from "@/db/schema";
import { searchTextFor } from "@/lib/candidate-search";
import { uploadRoot } from "@/lib/files";
import { todayIST } from "@/lib/ist";
import { activeLabels } from "@/lib/lists";
import { ensureListDefaults, getOptionLists } from "@/lib/lists-db";
import { ensureNotice, getActiveNotice } from "@/lib/notice-db";
import { SAMPLE_CRITERIA } from "@/lib/options";
import { createStaff } from "@/lib/staff";

const SLUG = "demo-sample";
const ADMIN_EMAIL = (process.env.DEMO_ADMIN_EMAIL || "demo-admin@demo.example.test").toLowerCase();

async function clear() {
  const [t] = await db.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.slug, SLUG));
  if (!t) return console.log("no demo tenant: nothing to clear");
  const ids = [t.id];
  for (const table of [s.candidateFiles, s.scorecards, s.queueEvents, s.consents, s.applications, s.panels, s.drives, s.dsrRequests, s.dataExports, s.candidates, s.dailyCounters, s.auditLog]) {
    await db.delete(table).where(inArray(table.tenantId, ids));
  }
  await db.delete(s.privacyNotices).where(inArray(s.privacyNotices.tenantId, ids));
  await db.delete(s.optionItems).where(inArray(s.optionItems.tenantId, ids));
  await db.delete(s.users).where(inArray(s.users.tenantId, ids)); // sessions + accounts cascade
  for (const table of [s.rejectReasons, s.jobs, s.stages, s.locations]) await db.delete(table).where(inArray(table.tenantId, ids));
  await db.delete(s.tenants).where(eq(s.tenants.id, t.id));
  const root = uploadRoot();
  if (root) fs.rmSync(path.join(root, t.id), { recursive: true, force: true });
  console.log("demo tenant and all its data removed");
}

async function seedDemo() {
  const password = process.env.DEMO_ADMIN_PASSWORD ?? "";
  if (password.length < 8) throw new Error("Put DEMO_ADMIN_PASSWORD (8+ characters) in .env first: the demo admin signs in with it.");
  const [existing] = await db.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.slug, SLUG));
  if (existing) throw new Error("The demo tenant already exists. Run npm run demo:clear first.");

  const [t] = await db.insert(s.tenants).values({ name: "Demo company (sample data)", slug: SLUG, tokenPrefix: "D", profileSample: false }).returning();
  await ensureListDefaults(t.id);
  await ensureNotice(t.id);
  const stages = await db
    .insert(s.stages)
    .values(["Registered", "HR screen", "Ops round", "Offer"].map((name, i) => ({ tenantId: t.id, name, position: i + 1, isInterview: i === 1 || i === 2, criteria: i === 1 || i === 2 ? SAMPLE_CRITERIA.map((label) => ({ label, required: false })) : [] })))
    .returning();
  const [loc] = await db.insert(s.locations).values({ tenantId: t.id, name: "Demo office" }).returning();
  const jobs = await db.insert(s.jobs).values(["Medical Coder (demo)", "AR Caller (demo)", "Payment Poster (demo)"].map((title) => ({ tenantId: t.id, title }))).returning();
  const adminId = await db.transaction((tx) => createStaff(tx, { tenantId: t.id, name: "Demo admin", email: ADMIN_EMAIL, role: "admin", password, temporary: false }));
  if (!adminId) throw new Error(`${ADMIN_EMAIL} is already used by another account; set DEMO_ADMIN_EMAIL.`);

  const lists = await getOptionLists(t.id);
  const notice = await getActiveNotice(t.id);
  const pick = <T,>(a: T[], i: number) => a[i % a.length];
  const today = todayIST();
  for (let i = 1; i <= 12; i++) {
    const profile = {
      fullName: `Sample candidate ${String(i).padStart(2, "0")}`,
      email: null,
      dateOfBirth: `199${i % 10}-0${(i % 9) + 1}-1${i % 9}`,
      city: pick(["Mohali", "Chandigarh", "Zirakpur", "Panchkula"], i),
      qualification: pick(activeLabels(lists, "education"), i),
      experienceMonths: (i * 7) % 60,
      currentCtc: i % 3 ? 240000 + i * 10000 : null,
      expectedCtc: 300000 + i * 15000,
      noticeDays: pick(lists.notice_period.filter((n) => n.active).map((n) => n.days!), i),
      languages: [pick(activeLabels(lists, "language"), i)],
      skills: "Demo data",
      certifications: i % 2 ? [pick(activeLabels(lists, "certification"), i)] : [],
      codingSpecialties: [],
      ehrSoftware: [pick(activeLabels(lists, "ehr_software"), i)],
      nightShiftOk: i % 2 === 0,
      voiceProcess: i % 3 === 0,
      typingWpm: 25 + i,
    };
    const [c] = await db
      .insert(s.candidates)
      .values({ tenantId: t.id, mobile: `90000000${String(i).padStart(2, "0")}`, ...profile, searchText: searchTextFor(profile) })
      .returning();
    const [app] = await db
      .insert(s.applications)
      .values({
        tenantId: t.id,
        candidateId: c.id,
        jobId: pick(jobs, i).id,
        locationId: loc.id,
        token: `D-${String(i).padStart(3, "0")}`,
        tokenDate: today,
        currentStageId: stages[0].id,
        clientRequestId: crypto.randomUUID(),
        source: pick(activeLabels(lists, "source"), i),
        hrNotes: "Demo data",
        createdBy: adminId,
      })
      .returning();
    await db.insert(s.consents).values({ tenantId: t.id, candidateId: c.id, applicationId: app.id, noticeVersion: notice.version, noticeId: notice.id, language: "en", recordedBy: adminId });
  }
  await db.insert(s.dailyCounters).values({ tenantId: t.id, counterDate: today, lastValue: 12 });
  console.log(`demo tenant created: 12 sample candidates; sign in as ${ADMIN_EMAIL} with DEMO_ADMIN_PASSWORD (remove with npm run demo:clear)`);
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Demo data is never added to a production install.");
  if (process.argv.includes("--clear")) await clear();
  else await seedDemo();
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
