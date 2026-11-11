// Server start-up (from src/instrumentation.ts), Node runtime only.
// RUN_MIGRATIONS=1 and SEED_ON_START=1 are set in the Docker image; the retention job runs unless PURGE_JOB=off.
// The standalone server.js changes into its own folder, so outside Docker set MIGRATIONS_DIR to the absolute drizzle/ path.
import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "@/db";
import { seed } from "@/db/seed-core";
import { startPurgeScheduler } from "@/lib/purge";

export async function boot() {
  if (process.env.RUN_MIGRATIONS === "1") {
    await migrate(db, { migrationsFolder: process.env.MIGRATIONS_DIR || path.resolve("drizzle") });
    console.log("database migrations applied");
  }
  if (process.env.SEED_ON_START === "1") await seed();
  if (process.env.PURGE_JOB !== "off") startPurgeScheduler();
}
