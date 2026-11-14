// Machine-specific configuration: every value comes from the environment (the install folder's .env on the office PC,
// .env in development) with safe defaults. Checked once at start-up (src/instrumentation-node.ts): a missing or
// invalid value stops the server with a message naming the variable. Documented in .env.example and docs/INSTALL.md.
import path from "node:path";
import { z } from "zod";
import { APP_TIME_ZONE } from "@/lib/ist";

const absFolder = (name: string) =>
  z.string().trim().refine((v) => path.isAbsolute(v), `${name} must be an absolute folder path, for example D:\\data\\${name === "UPLOAD_DIR" ? "uploads" : "backups"}`);
const int = (name: string, def: number, min: number, max: number) =>
  z.coerce.number(`${name} must be a whole number`).int(`${name} must be a whole number`).min(min, `${name} must be ${min} to ${max}`).max(max, `${name} must be ${min} to ${max}`).default(def);
const flag = (def: "0" | "1") => z.enum(["0", "1"], "must be 0 or 1").default(def);
const empty = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = <T extends z.ZodType>(s: T) => z.preprocess(empty, s.optional());
const url = (name: string) =>
  z
    .string(`${name} is required`)
    .trim()
    .refine((v) => /^https?:\/\/[^/\s]+$/.test(v.replace(/\/$/, "")), `${name} must be an address like https://server.example.com (no path)`);
const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

export const ConfigSchema = z.object({
  DATABASE_URL: z
    .string("DATABASE_URL is required (postgres://user:password@host:5432/database)")
    .trim()
    .refine((v) => /^postgres(ql)?:\/\/[^@\s]+@[^/\s]+\/\w+/.test(v), "DATABASE_URL must look like postgres://user:password@host:5432/database"),
  PORT: opt(int("PORT", 3000, 1, 65535)),
  HOSTNAME: opt(z.string().trim().regex(/^[\w.:-]+$/, "HOSTNAME must be an address such as 127.0.0.1 or 0.0.0.0")),
  // ---- file storage (src/lib/storage.ts): a folder on the office PC, or an S3 bucket on AWS ----
  STORAGE_DRIVER: z.enum(["local", "s3"], "STORAGE_DRIVER must be local or s3").default("local"),
  // Required when STORAGE_DRIVER=local (checked below): zod skips a missing optional key, so the rule is in superRefine.
  UPLOAD_DIR: opt(absFolder("UPLOAD_DIR")),
  S3_BUCKET: opt(z.string().trim().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, "S3_BUCKET must be a bucket name like hirefolios-simplen-uploads")),
  S3_REGION: z.preprocess(empty, z.string().trim().regex(/^[a-z]{2}(-[a-z]+)+-\d$/, "S3_REGION must look like ap-south-1").default("ap-south-1")),
  // Only for an S3-compatible test server (e.g. http://127.0.0.1:7070); empty on AWS.
  S3_ENDPOINT: opt(z.string().trim().regex(/^https?:\/\/[^/\s]+\/?$/, "S3_ENDPOINT must be an address like http://127.0.0.1:7070")),
  S3_FORCE_PATH_STYLE: flag("0"),
  // Server-side encryption of every object (AWS: SSE-S3 = AES256)
  S3_SSE: z.enum(["AES256", "aws:kms", "none"], "S3_SSE must be AES256, aws:kms or none").default("AES256"),
  // on: /api/files answers with a short-lived signed URL (after the login + tenant checks); off: the app streams the file
  S3_SIGNED_URLS: z.enum(["on", "off"], "S3_SIGNED_URLS must be on or off").default("off"),
  S3_SIGNED_URL_SECONDS: int("S3_SIGNED_URL_SECONDS", 60, 10, 900),
  // ---- database (managed PostgreSQL on AWS: TLS + a small pool) ----
  DB_SSL: z.enum(["disable", "require", "verify-full"], "DB_SSL must be disable, require or verify-full").default("disable"),
  DB_SSL_CA_FILE: opt(z.string().trim().refine((v) => path.isAbsolute(v), "DB_SSL_CA_FILE must be an absolute file path (the provider's CA bundle)")),
  DB_POOL_MAX: int("DB_POOL_MAX", 10, 1, 50),
  // ---- backups to S3 (AWS); the office PC keeps deploy/windows/backup.ps1 ----
  BACKUP_BUCKET: opt(z.string().trim().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, "BACKUP_BUCKET must be a bucket name like hirefolios-simplen-backups")),
  BACKUP_ENCRYPTION_KEY: opt(z.string().trim().refine((v) => Buffer.from(v, "base64").length === 32, "BACKUP_ENCRYPTION_KEY must be 32 random bytes in base64 (node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\")")),
  BACKUP_TIME: z.preprocess(empty, z.string().trim().regex(hhmm, "BACKUP_TIME must look like 02:30 (India time)").default("02:30")),
  PG_DUMP_PATH: opt(z.string().trim()),
  PG_RESTORE_PATH: opt(z.string().trim()),
  // ---- internet-facing security ----
  // Roles that must use an authenticator app (two-factor), e.g. "admin,hr". Empty: optional for everyone.
  TWO_FACTOR_REQUIRED_ROLES: z.preprocess(
    empty,
    z
      .string()
      .trim()
      .refine((v) => v.split(",").every((r) => ["admin", "hr", "manager", "interviewer"].includes(r.trim())), "TWO_FACTOR_REQUIRED_ROLES must list roles from admin, hr, manager, interviewer (comma-separated)")
      .optional(),
  ),
  // Sign-in attempts per IP address: "<count>/<seconds>". An office behind one internet address shares it.
  SIGN_IN_LIMIT: z.preprocess(empty, z.string().trim().regex(/^\d{1,4}\/\d{1,5}$/, "SIGN_IN_LIMIT must look like 20/60 (attempts / seconds)").default("20/60")),
  LOCKOUT_ATTEMPTS: int("LOCKOUT_ATTEMPTS", 5, 3, 20),
  LOCKOUT_MINUTES: int("LOCKOUT_MINUTES", 15, 1, 1440),
  API_RATE_LIMIT_PER_MINUTE: int("API_RATE_LIMIT_PER_MINUTE", 600, 60, 10000),
  // Emergency switch: ignore the office IP allow-list (Settings → Security) if an admin locked everyone out.
  IP_ALLOWLIST_OFF: flag("0"),
  LOG_FORMAT: z.enum(["text", "json"], "LOG_FORMAT must be text or json").default("text"),
  BACKUP_DIR: opt(absFolder("BACKUP_DIR")),
  BACKUP_STATUS_FILE: opt(z.string().trim().refine((v) => path.isAbsolute(v), "BACKUP_STATUS_FILE must be an absolute file path")),
  BETTER_AUTH_URL: url("BETTER_AUTH_URL"),
  BETTER_AUTH_SECRET: z.string("BETTER_AUTH_SECRET is required").min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_TRUSTED_ORIGINS: opt(
    z
      .string()
      .refine((v) => v.split(",").every((o) => /^https?:\/\/[^/\s]+$/.test(o.trim().replace(/\/$/, ""))), "BETTER_AUTH_TRUSTED_ORIGINS must be addresses like http://192.168.1.20:3000, comma-separated"),
  ),
  STAFF_SESSION_HOURS: int("STAFF_SESSION_HOURS", 12, 1, 24),
  DISPLAY_SESSION_DAYS: int("DISPLAY_SESSION_DAYS", 30, 1, 90),
  MAX_UPLOAD_MB: int("MAX_UPLOAD_MB", 8, 1, 25),
  MAX_CV_FILES: int("MAX_CV_FILES", 5, 1, 10),
  MAX_CV_PAGES: int("MAX_CV_PAGES", 10, 1, 20),
  PURGE_JOB: z.enum(["on", "off"], "PURGE_JOB must be on or off").default("on"),
  PURGE_INTERVAL_MINUTES: int("PURGE_INTERVAL_MINUTES", 30, 5, 1440),
  // The deletion job waits outside these hours (India time), e.g. 09:00-19:00. Empty: any time.
  OFFICE_HOURS: opt(
    z
      .string()
      .trim()
      .refine((v) => {
        const [a, b] = v.split("-");
        return hhmm.test(a ?? "") && hhmm.test(b ?? "") && a !== b;
      }, "OFFICE_HOURS must look like 09:00-19:00"),
  ),
  RUN_MIGRATIONS: flag("0"),
  MIGRATIONS_DIR: opt(z.string().trim().refine((v) => path.isAbsolute(v), "MIGRATIONS_DIR must be an absolute folder path")),
  SEED_ON_START: flag("0"),
  APP_VERSION: opt(z.string().trim()),
});

/** Rules between variables, checked on the raw environment so they are listed together with every other problem. */
function crossProblems(env: Record<string, string | undefined>) {
  const v = (k: string) => env[k]?.trim() || "";
  const out: string[] = [];
  const driver = v("STORAGE_DRIVER") || "local";
  if (driver === "local" && !v("UPLOAD_DIR")) out.push("UPLOAD_DIR is required (folder for photos and CVs) when STORAGE_DRIVER=local");
  if (driver === "s3" && !v("S3_BUCKET")) out.push("S3_BUCKET is required when STORAGE_DRIVER=s3");
  if (v("BACKUP_BUCKET") && !v("BACKUP_ENCRYPTION_KEY")) out.push("BACKUP_ENCRYPTION_KEY is required when BACKUP_BUCKET is set (backups are encrypted)");
  if (v("BACKUP_BUCKET") && v("BACKUP_BUCKET") === v("S3_BUCKET")) out.push("BACKUP_BUCKET must be a different bucket from S3_BUCKET");
  if (v("DB_SSL") === "verify-full" && !v("DB_SSL_CA_FILE")) out.push("DB_SSL_CA_FILE is required when DB_SSL=verify-full");
  const [n, s] = (v("SIGN_IN_LIMIT") || "20/60").split("/").map(Number);
  if (!(n >= 1 && s >= 1)) out.push("SIGN_IN_LIMIT must be at least 1/1");
  return out;
}
export type Config = z.output<typeof ConfigSchema>;

export class ConfigError extends Error {
  constructor(public problems: string[]) {
    super(`Configuration error (check the settings file .env):\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

/** Parses an environment; throws ConfigError listing every problem, each naming its variable. */
export function parseConfig(env: Record<string, string | undefined>): Config {
  const r = ConfigSchema.safeParse(env);
  const problems = [...(r.success ? [] : r.error.issues.map((i) => (i.message.includes(String(i.path[0])) ? i.message : `${String(i.path[0])}: ${i.message}`))), ...crossProblems(env)];
  if (problems.length) throw new ConfigError(problems);
  return r.data!;
}

let cached: Config | null = null;
/** The validated configuration of this process (from process.env). */
export function config(): Config {
  return (cached ??= parseConfig(process.env));
}

/** Upload limits handed to the intake wizard and checked again by POST /api/intake. */
export function uploadLimits() {
  const c = config();
  return {
    maxCvFiles: c.MAX_CV_FILES,
    maxCvPages: c.MAX_CV_PAGES,
    maxUploadBytes: c.MAX_UPLOAD_MB * 1024 * 1024,
    maxPageBytes: 4 * 1024 * 1024, // one photographed CV page: the wizard makes ~1800 px JPEGs
    maxPhotoBytes: 2 * 1024 * 1024, // live photo: the wizard makes ~800 px JPEGs
  };
}

/** True while the office is open (the deletion job waits). Times are India time. */
export function inOfficeHours(now: Date, hours: string | undefined) {
  if (!hours) return false;
  const [a, b] = hours.split("-");
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  return a < b ? t >= a && t < b : t >= a || t < b; // e.g. 22:00-06:00 crosses midnight
}
