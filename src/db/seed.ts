// Idempotent: safe to run again; existing rows are left as they are.
// Run with `npm run db:seed` (loads .env if present).
import { and, eq } from "drizzle-orm";
import { db, pgClient } from "@/db";
import { jobs, locations, stages, tenants, users } from "@/db/schema";
import { audit, createStaff } from "@/lib/staff";

const TENANT = { name: "Simplen Billing e-Services", slug: "simplen", tokenPrefix: "SB" };
const STAGES = [
  "Registered",
  "HR screen",
  "Typing/voice test",
  "Ops round",
  "Manager round",
  "Offer",
  "Joined",
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

async function main() {
  await db.insert(tenants).values(TENANT).onConflictDoNothing({ target: tenants.slug });
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.slug, TENANT.slug) });
  if (!tenant) throw new Error("tenant upsert failed");

  await db
    .insert(stages)
    .values(STAGES.map((name, i) => ({ tenantId: tenant.id, name, position: i + 1 })))
    .onConflictDoNothing();
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
  ]);
  console.log(`tenant "${tenant.slug}": stages=${counts[0]} jobs=${counts[1]} locations=${counts[2]} users=${counts[3]}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
