// Server start-up, Node runtime only: src/instrumentation.ts imports this file only when
// NEXT_RUNTIME is "nodejs", so the edge compile never sees the migrator, the database or node:* modules.
// RUN_MIGRATIONS=1 is set by deploy/windows/install.ps1 (SEED_ON_START=1 only until the first admin exists); the retention job runs unless PURGE_JOB=off.
// The standalone server.js changes into its own folder, so set MIGRATIONS_DIR to the absolute drizzle/ path.
import "server-only";
import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "@/db";
import { seed } from "@/db/seed-core";
import { startPurgeScheduler } from "@/lib/purge";

try {
  if (process.env.RUN_MIGRATIONS === "1") {
    await migrate(db, { migrationsFolder: process.env.MIGRATIONS_DIR || path.resolve("drizzle") });
    console.log("database migrations applied");
  }
  if (process.env.SEED_ON_START === "1") await seed();
  if (process.env.PURGE_JOB !== "off") startPurgeScheduler();
} catch (e) {
  // Don't serve on a half-migrated database: exit so the Windows service restarts it (and update.ps1 rolls back).
  console.error("start-up failed:", e);
  process.exit(1);
}
