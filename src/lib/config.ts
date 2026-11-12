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
  // Plain required string: zod skips a missing key whose schema is optional-like, so no preprocess here.
  UPLOAD_DIR: z.string("UPLOAD_DIR is required (folder for photos and CVs)").trim().min(1, "UPLOAD_DIR is required (folder for photos and CVs)").pipe(absFolder("UPLOAD_DIR")),
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
  if (r.success) return r.data;
  throw new ConfigError(r.error.issues.map((i) => (i.message.includes(String(i.path[0])) ? i.message : `${String(i.path[0])}: ${i.message}`)));
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
