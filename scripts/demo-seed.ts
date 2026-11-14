// Demo data, on request only. Never runs by itself and is not part of a release (npm run package ships no scripts/).
//   npm run demo:seed    a separate "demo" tenant (its own lists, notice, jobs) with 12 sample candidates, all
//                        named "Sample candidate NN", and a demo admin to look at them: DEMO_ADMIN_EMAIL (default
//                        demo-admin@demo.example.test) with the password you put in .env as DEMO_ADMIN_PASSWORD.
//   npm run demo:clear   removes that tenant and everything in it (rows and files).
// It never touches any other tenant. Refuses to run when NODE_ENV=production.
import { eq, inArray } from "drizzle-orm";
import { db, pgClient } from "@/db";
import * as s from "@/db/schema";
import { searchTextFor } from "@/lib/candidate-search";
import { storage } from "@/lib/storage";
import { todayIST } from "@/lib/ist";
import { activeLabels } from "@/lib/lists";
import { ensureListDefaults, getOptionLists } from "@/lib/lists-db";
import { ensureNotice, getActiveNotice } from "@/lib/notice-db";
import { REJECT_REASONS, SAMPLE_CRITERIA } from "@/lib/options";
import { categoryForSampleReason } from "@/lib/rediscovery/categories";
import { addDays } from "@/lib/rediscovery/contact";
import { createStaff } from "@/lib/staff";

const SLUG = "demo-sample";
const ADMIN_EMAIL = (process.env.DEMO_ADMIN_EMAIL || "demo-admin@demo.example.test").toLowerCase();

async function clear() {
  const [t] = await db.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.slug, SLUG));
  if (!t) return console.log("no demo tenant: nothing to clear");
  const ids = [t.id];
  // Phase 3.6 rows (tags, contact log, call-backs, other offers, pushes, settings) cascade with candidates and the tenant
  for (const table of [s.candidateFiles, s.scorecards, s.queueEvents, s.consents, s.applications, s.panels, s.drives, s.dsrRequests, s.dataExports, s.candidates, s.dailyCounters, s.auditLog]) {
    await db.delete(table).where(inArray(table.tenantId, ids));
  }
  await db.delete(s.privacyNotices).where(inArray(s.privacyNotices.tenantId, ids));
  await db.delete(s.optionItems).where(inArray(s.optionItems.tenantId, ids));
  await db.delete(s.users).where(inArray(s.users.tenantId, ids)); // sessions + accounts cascade
  for (const table of [s.rejectReasons, s.jobs, s.stages, s.locations]) await db.delete(table).where(inArray(table.tenantId, ids));
  await db.delete(s.tenants).where(eq(s.tenants.id, t.id));
  const keys: string[] = [];
  for await (const o of storage().list(`${t.id}/`)) keys.push(o.key);
  await storage().delete(keys); // the demo tenant has no files today; this keeps clear complete if it ever gets some
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
  await seedRediscovery({ tenantId: t.id, adminId, stages, locId: loc.id, jobs, noticeVersion: notice.version, noticeId: notice.id });
  console.log(`demo tenant created: 20 sample candidates (8 with rediscovery history); sign in as ${ADMIN_EMAIL} with DEMO_ADMIN_PASSWORD (remove with npm run demo:clear)`);
}

/**
 * Phase 3.6 demo (docs/REDISCOVERY.md): cost rejections, a near-miss, a returning candidate with a score change,
 * call-backs due today, an offer with joining-risk hints and one hiring push. Demo tenant only.
 */
async function seedRediscovery(d: {
  tenantId: string;
  adminId: string;
  stages: (typeof s.stages.$inferSelect)[];
  locId: string;
  jobs: (typeof s.jobs.$inferSelect)[];
  noticeVersion: string;
  noticeId: string;
}) {
  const { tenantId, adminId, stages, locId, jobs } = d;
  await db.insert(s.rejectReasons).values(REJECT_REASONS.map((label, i) => ({ tenantId, label, position: i + 1, sample: true, categoryCode: categoryForSampleReason(label) })));
  await db.insert(s.rejectReasons).values({ tenantId, label: "Position filled / better candidate chosen", position: 20, categoryCode: "seat_filled" });
  const [hr, ops] = [stages[1], stages[2]];
  const today = todayIST();
  const at = (day: string, h = 11) => new Date(`${day}T${String(h).padStart(2, "0")}:00:00+05:30`);
  let n = 12;
  async function person(o: { expected: number; notice: number; night: boolean; city?: string; certs?: string[] }) {
    n++;
    const profile = {
      fullName: `Sample candidate ${n}`,
      dateOfBirth: "1996-04-1" + (n % 9),
      city: o.city ?? "Mohali",
      qualification: "B.Com",
      experienceMonths: 18 + n,
      expectedCtc: o.expected,
      noticeDays: o.notice,
      languages: ["English", "Hindi"],
      skills: "Demo data",
      certifications: o.certs ?? ["CPC"],
      codingSpecialties: [],
      ehrSoftware: ["Epic"],
      nightShiftOk: o.night,
      voiceProcess: true,
      typingWpm: 35,
    };
    const [c] = await db.insert(s.candidates).values({ tenantId, mobile: `90000000${n}`, ...profile, email: null, searchText: searchTextFor(profile) }).returning();
    return c.id;
  }
  async function visit(candidateId: string, o: { day: string; outcome: "rejected" | "selected" | "on_hold"; reason?: string; category?: string; cost?: [number, number | null]; stage: typeof hr; scores: [typeof hr, number, number][]; job?: number }) {
    const [a] = await db
      .insert(s.applications)
      .values({
        tenantId,
        candidateId,
        jobId: jobs[o.job ?? 1].id,
        locationId: locId,
        token: `D-${100 + n}-${o.day.slice(5)}`,
        tokenDate: o.day,
        currentStageId: o.stage.id,
        outcome: o.outcome,
        rejectReason: o.reason ?? null,
        rejectCategory: o.category ?? null,
        costExpectedCtc: o.cost?.[0] ?? null,
        costBudgetCtc: o.cost?.[1] ?? null,
        clientRequestId: crypto.randomUUID(),
        createdAt: at(o.day, 10),
        decidedAt: o.outcome === "on_hold" ? null : at(o.day, 13),
        purgeAfter: o.outcome === "rejected" ? at(addDays(o.day, 365)) : null,
        photoPurgeAfter: o.outcome === "rejected" ? at(addDays(o.day, 180)) : null,
        source: "Walk-in (saw the board / heard nearby)",
        createdBy: adminId,
      })
      .returning();
    await db.insert(s.consents).values({ tenantId, candidateId, applicationId: a.id, noticeVersion: d.noticeVersion, noticeId: d.noticeId, language: "en", whatsapp: true, recordedBy: adminId, acceptedAt: at(o.day, 10) });
    for (const [stage, comm, know] of o.scores) {
      await db.insert(s.scorecards).values({ tenantId, applicationId: a.id, stageId: stage.id, interviewerId: adminId, scores: { Communication: comm, "Process knowledge": know }, overall: Math.round((comm + know) / 2), decision: "pass", updatedAt: at(o.day, 12) });
    }
    return a.id;
  }
  const ago = (days: number) => addDays(today, -days);
  // cost rejections: two strong (suggestions), one weak (no suggestion)
  const c1 = await person({ expected: 420000, notice: 30, night: true });
  await visit(c1, { day: ago(20), outcome: "rejected", reason: "Salary expectation above budget", category: "cost", cost: [420000, 300000], stage: ops, scores: [[hr, 4, 4], [ops, 4, 5]] });
  const c2 = await person({ expected: 380000, notice: 15, night: true });
  await visit(c2, { day: ago(45), outcome: "rejected", reason: "Salary expectation above budget", category: "cost", cost: [380000, null], stage: hr, scores: [[hr, 4, 4]] });
  await db.insert(s.candidateTags).values({ tenantId, candidateId: c2, tagCode: "high_cost", note: "Demo: accepted suggestion", source: "suggestion", addedBy: adminId });
  const c3 = await person({ expected: 450000, notice: 30, night: false });
  await visit(c3, { day: ago(10), outcome: "rejected", reason: "Salary expectation above budget", category: "cost", cost: [450000, 300000], stage: hr, scores: [[hr, 2, 3]] });
  // near-miss: seat filled at the last round
  const c4 = await person({ expected: 330000, notice: 0, night: true });
  await visit(c4, { day: ago(5), outcome: "rejected", reason: "Position filled / better candidate chosen", category: "seat_filled", stage: ops, scores: [[hr, 3, 4], [ops, 4, 3]] });
  // returning candidate: 2.8 → 3.9
  const c5 = await person({ expected: 300000, notice: 30, night: true });
  await visit(c5, { day: ago(90), outcome: "rejected", reason: "No relevant RCM experience", category: "knowledge", stage: hr, scores: [[hr, 3, 2.6]] });
  await visit(c5, { day: ago(2), outcome: "rejected", reason: "Notice period too long", category: "notice_timing", stage: hr, scores: [[hr, 4, 3.8]] });
  // call-backs due today: notice period, and an on-hold candidate
  await db.insert(s.callbacks).values({ tenantId, candidateId: c5, dueOn: today, note: "Notice period ends this week", createdBy: adminId });
  const c6 = await person({ expected: 310000, notice: 60, night: true });
  await visit(c6, { day: ago(30), outcome: "on_hold", stage: hr, scores: [[hr, 4, 3]] });
  await db.insert(s.callbacks).values({ tenantId, candidateId: c6, dueOn: today, note: "On hold: call when the new batch opens", createdBy: adminId });
  // an offer with joining-risk hints (other offer in hand + 90-day notice)
  const c7 = await person({ expected: 400000, notice: 90, night: true });
  const offerApp = await visit(c7, { day: ago(3), outcome: "selected", stage: stages[3], scores: [[hr, 4, 4], [ops, 4, 4]] });
  await db.update(s.applications).set({ offerStatus: "offered", offeredCtc: 340000, joiningDate: addDays(today, 45), riskHints: ["other_offer", "notice", "ctc_gap", "joining_far"] }).where(eq(s.applications.id, offerApp));
  await db.insert(s.otherOffers).values({ tenantId, candidateId: c7, company: "Demo Other RCM Ltd", offeredCtc: 380000, notedOn: ago(3), createdBy: adminId });
  // a talent-pool candidate and one Do not rehire
  const c8 = await person({ expected: 290000, notice: 15, night: true });
  await visit(c8, { day: ago(60), outcome: "rejected", reason: "Not willing to work US / night shift", category: "shift_location", stage: hr, scores: [[hr, 4, 4]] });
  await db.insert(s.consents).values({ tenantId, candidateId: c8, noticeVersion: d.noticeVersion, noticeId: d.noticeId, language: "en", talentPool: true, whatsapp: true, recordedBy: adminId, channel: "phone", note: "Demo: said yes on the phone" });
  await db.update(s.applications).set({ purgeAfter: null, photoPurgeAfter: null }).where(eq(s.applications.candidateId, c8));
  await db.insert(s.candidateTags).values({ tenantId, candidateId: c3, tagCode: "do_not_rehire", note: "Demo: left during training", source: "manual", addedBy: adminId });
  // one hiring push
  const [push] = await db.insert(s.hiringPushes).values({ tenantId, name: "Demo AR callers — bulk work", criteria: { jobs: [], needed: 5, budget: 4.5, cert: [], ehr: [], night: "yes" }, createdBy: adminId }).returning();
  await db.insert(s.pushMembers).values([
    { tenantId, pushId: push.id, candidateId: c1, rank: 1, score: 88, why: "Cost reject · asked 4.2 ≤ budget 4.5 · avg 4.3 · night OK", status: "interested", updatedBy: adminId },
    { tenantId, pushId: push.id, candidateId: c4, rank: 2, score: 84, why: "Near-miss (Seat filled / better candidate chosen) · asked 3.3 ≤ budget 4.5 · avg 3.5 · night OK", status: "to_call", updatedBy: adminId },
    { tenantId, pushId: push.id, candidateId: c2, rank: 3, score: 80, why: "Cost reject · asked 3.8 ≤ budget 4.5 · avg 4.0 · night OK", status: "no_answer", updatedBy: adminId },
  ]);
  await db.insert(s.contactLog).values({ tenantId, candidateId: c1, channel: "call", purpose: "bulk_push", outcome: "interested", note: "Demo call", pushId: push.id, contactedBy: adminId, contactedAt: at(ago(1)) });
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
