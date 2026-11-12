// Idempotent seed: safe to run again; existing rows are left as they are.
// Used by `npm run db:seed` (src/db/seed.ts) and, with SEED_ON_START=1, by the server at start-up.
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, locations, rejectReasons, stages, tenants, users } from "@/db/schema";
import { REJECT_REASONS, SAMPLE_CRITERIA } from "@/lib/options";
import { ensureListDefaults } from "@/lib/lists-db";
import { ensureNotice } from "@/lib/notice-db";
import { audit, createStaff } from "@/lib/staff";

// Starting company profile; an admin confirms it in Settings → Company (profile_sample stays true until then).
const TENANT = { name: "Simplen Billing e-Services", slug: "simplen", tokenPrefix: "A" };
// Sample pipeline for Simplen HR to confirm in Settings. Interview rounds get the sample criteria.
const STAGES = [
  { name: "Registered", isInterview: false },
  { name: "HR screen", isInterview: true },
  { name: "Typing/voice test", isInterview: true },
  { name: "Ops round", isInterview: true },
  { name: "Manager round", isInterview: true },
  { name: "Offer", isInterview: false },
  { name: "Joined", isInterview: false },
];
// Sample positions for Simplen HR to confirm in Settings (flagged `sample` until saved there).
// Missing titles are added; existing jobs are never changed or deleted.
const JOBS = [
  "Medical Coder",
  "Medical Biller / Charge Entry",
  "Payment Poster",
  "AR Caller / AR Analyst",
  "Denial Management Executive",
  "Credentialing Specialist",
  "Eligibility & Prior Authorization",
  "Patient Support / Front Desk (US voice)",
  "Team Lead / QA",
  "Digital Marketing Executive",
  "Other / General",
];
const SAMPLE_LOCATION = "Main office (sample, rename me)";

export async function seed() {
  await db.insert(tenants).values(TENANT).onConflictDoNothing({ target: tenants.slug });
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.slug, TENANT.slug) });
  if (!tenant) throw new Error("tenant upsert failed");
  // Pick-lists and the privacy notice: starting versions marked "sample / draft", for Simplen to confirm in Settings.
  await ensureListDefaults(tenant.id);
  await ensureNotice(tenant.id);

  // Stages and reject reasons are editable in Settings, so they are seeded only into an empty tenant
  // (a renamed sample must not come back on the next seed run).
  if ((await db.$count(stages, eq(stages.tenantId, tenant.id))) === 0) {
    await db.insert(stages).values(
      STAGES.map((st, i) => ({
        tenantId: tenant.id,
        name: st.name,
        position: i + 1,
        isInterview: st.isInterview,
        criteria: st.isInterview ? SAMPLE_CRITERIA.map((label) => ({ label, required: false })) : [],
        sample: true,
      })),
    );
  }
  if ((await db.$count(rejectReasons, eq(rejectReasons.tenantId, tenant.id))) === 0) {
    await db.insert(rejectReasons).values(REJECT_REASONS.map((label, i) => ({ tenantId: tenant.id, label, position: i + 1, sample: true })));
  }
  await db
    .insert(jobs)
    .values(JOBS.map((title) => ({ tenantId: tenant.id, title, sample: true })))
    .onConflictDoNothing();
  await db
    .insert(locations)
    .values({ tenantId: tenant.id, name: SAMPLE_LOCATION })
    .onConflictDoNothing();

  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "";
  const hasAdmin = await db.query.users.findFirst({
    columns: { id: true },
    where: and(eq(users.tenantId, tenant.id), eq(users.role, "admin"), eq(users.active, true)),
  });

  if (!email) {
    if (!hasAdmin) throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to create the first admin.");
    console.log("admin: SEED_ADMIN_EMAIL not set, tenant already has an admin, skipped");
  } else if (await db.query.users.findFirst({ columns: { id: true }, where: eq(users.email, email) })) {
    console.log("admin: already exists, password not changed");
  } else {
    if (password.length < 8 || password.length > 128) {
      throw new Error("SEED_ADMIN_PASSWORD must be 8 to 128 characters.");
    }
    await db.transaction(async (tx) => {
      const id = await createStaff(tx, {
        tenantId: tenant.id,
        name: process.env.SEED_ADMIN_NAME?.trim() || "Admin",
        email,
        role: "admin",
        password, // chosen by whoever runs the seed, so no forced change
        temporary: false,
      });
      if (!id) throw new Error("admin email already taken");
      await audit(tx, { tenantId: tenant.id, actorUserId: null, action: "user.create", entityType: "user", entityId: id, meta: { role: "admin", via: "seed" } });
    });
    console.log("admin: created");
  }

  const counts = await Promise.all([
    db.$count(stages, eq(stages.tenantId, tenant.id)),
    db.$count(jobs, eq(jobs.tenantId, tenant.id)),
    db.$count(locations, eq(locations.tenantId, tenant.id)),
    db.$count(users, eq(users.tenantId, tenant.id)),
    db.$count(rejectReasons, eq(rejectReasons.tenantId, tenant.id)),
  ]);
  console.log(`tenant "${tenant.slug}": stages=${counts[0]} jobs=${counts[1]} locations=${counts[2]} users=${counts[3]} reject_reasons=${counts[4]}`);
}

