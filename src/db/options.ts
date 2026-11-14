// PostgreSQL connection options from the environment, shared by the app (src/db/index.ts), db:check and the backup
// helpers. No "server-only" here so scripts run under plain tsx can import it.
import fs from "node:fs";
import type postgres from "postgres";

/**
 * Connection options from the environment (validated at start-up by src/lib/config.ts; read here directly because the
 * scripts use the database without the rest of the configuration). Managed PostgreSQL on AWS: DB_SSL=require (TLS) or
 * verify-full (TLS + the provider's CA bundle in DB_SSL_CA_FILE), and a small pool (DB_POOL_MAX, default 10) that fits a
 * 1 GB database's connection limit with room for backups and a second app instance.
 */
export function dbOptions(env: Record<string, string | undefined> = process.env): postgres.Options<Record<string, never>> {
  const mode = env.DB_SSL?.trim() || "disable";
  const ssl =
    mode === "verify-full"
      ? { ca: fs.readFileSync(env.DB_SSL_CA_FILE!.trim(), "utf8"), rejectUnauthorized: true }
      : mode === "require"
        ? ("require" as const)
        : false;
  return {
    max: Number(env.DB_POOL_MAX) || 10,
    ssl,
    idle_timeout: 60, // seconds: give idle connections back to a small managed database
    connect_timeout: 15,
    max_lifetime: 60 * 30, // recycle connections every 30 minutes (managed DB failovers, rotated certificates)
    onnotice: () => {}, // NOTICEs ("already exists, skipping") would print as multi-line objects and break JSON logs
  };
}
