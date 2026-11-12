// Server start-up, Node runtime only: src/instrumentation.ts imports this file only when
// NEXT_RUNTIME is "nodejs", so the edge compile never sees the migrator, the database or node:* modules.
// Order: Node.js version → configuration (.env) → PostgreSQL reachable and the pinned version → migrations
// (RUN_MIGRATIONS=1, set by deploy/windows/install.ps1) → seed (SEED_ON_START=1 only until the first admin exists)
// → deletion job (unless PURGE_JOB=off). Any failure stops the server with a plain message (exit code 1), so the
// Windows service restarts it and update.ps1 rolls back; it never serves on a wrong or half-migrated setup.
// The standalone server.js changes into its own folder, so set MIGRATIONS_DIR to the absolute drizzle/ path.
import "server-only";
import path from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "@/db";
import { brand } from "@/lib/brand";
import { seed } from "@/db/seed-core";
import { config, ConfigError } from "@/lib/config";
import { startPurgeScheduler } from "@/lib/purge";
import { nodeVersionProblem, postgresVersionProblem } from "@/lib/runtime-check";

function stop(message: string): never {
  console.error(`\n${brand.name} cannot start:\n${message}\n`);
  process.exit(1);
}

const nodeProblem = nodeVersionProblem(process.versions.node);
if (nodeProblem) stop(nodeProblem);

let cfg: ReturnType<typeof config>;
try {
  cfg = config();
} catch (e) {
  if (e instanceof ConfigError) stop(e.message);
  throw e;
}

try {
  let versionNum: number;
  try {
    const [row] = await db.execute<{ v: string }>(sql`select current_setting('server_version_num') as v`);
    versionNum = Number(row.v);
  } catch (e) {
    const where = cfg.DATABASE_URL.replace(/\/\/[^@]*@/, "//"); // never print the password
    // drizzle wraps the driver error ("Failed query: ..."): the reason is in its cause
    // and a refused connection (::1 and 127.0.0.1 both tried) is an AggregateError with an empty message
    const c = ((e as { cause?: unknown }).cause ?? e) as { message?: string; code?: string; errors?: { message?: string }[] };
    const reason = c.message || c.errors?.[0]?.message || c.code || "connection failed";
    stop(`Cannot reach the database at ${where} (DATABASE_URL): ${reason}. Is the PostgreSQL service running, and are the user and password in DATABASE_URL right?`);
  }
  const pgProblem = postgresVersionProblem(versionNum);
  if (pgProblem) stop(pgProblem);
  if (cfg.RUN_MIGRATIONS === "1") {
    await migrate(db, { migrationsFolder: cfg.MIGRATIONS_DIR || path.resolve("drizzle") });
    console.log("database migrations applied");
  }
  if (cfg.SEED_ON_START === "1") await seed();
  if (cfg.PURGE_JOB !== "off") startPurgeScheduler();
} catch (e) {
  console.error("start-up failed:", e);
  process.exit(1);
}
