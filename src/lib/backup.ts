// Database backups to S3 (AWS deploy; the office PC keeps deploy/windows/backup.ps1). Nightly at BACKUP_TIME (India
// time): pg_dump (custom format) → AES-256-GCM with BACKUP_ENCRYPTION_KEY → BACKUP_BUCKET, under
//   daily/<YYYY-MM-DD>/<file>.dump.enc   (+ .json manifest)  — bucket lifecycle keeps 30 days
//   monthly/<YYYY-MM>/<file>.dump.enc    (first backup of a month) — bucket lifecycle keeps 365 days
// plus status/last-backup.json for /api/health. Uploaded files are protected by S3 versioning on the uploads bucket
// (docs/DEPLOY-AWS.md). Restore: npm run restore:s3. Nothing here logs personal data, keys or passwords.
import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CopyObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import postgres from "postgres";
import { dbOptions } from "@/db";
import { config } from "@/lib/config";
import { todayIST, APP_TIME_ZONE } from "@/lib/ist";
import { log } from "@/lib/log";
import { s3Client, s3SettingsFrom } from "@/lib/storage";
import pkg from "../../package.json";

const MAGIC = Buffer.from("HFB1"); // file format: "HFB1" | 12-byte IV | ciphertext | 16-byte GCM tag

/** Encrypting transform: MAGIC + IV first, the GCM tag last. */
export function encryptStream(key: Buffer) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  let started = false;
  return new Transform({
    transform(chunk: Buffer, _e, cb: TransformCallback) {
      if (!started) {
        this.push(Buffer.concat([MAGIC, iv]));
        started = true;
      }
      cb(null, c.update(chunk));
    },
    flush(cb) {
      if (!started) this.push(Buffer.concat([MAGIC, iv]));
      this.push(c.final());
      this.push(c.getAuthTag());
      cb();
    },
  });
}

/** Decrypts a whole encrypted file (backups are read from a temp file, so the tag at the end is known). */
export async function decryptFile(src: string, dest: string, key: Buffer) {
  const fh = await fs.open(src, "r");
  try {
    const { size } = await fh.stat();
    if (size < 32) throw new Error("backup file is too small to be a backup");
    const head = Buffer.alloc(16);
    await fh.read(head, 0, 16, 0);
    if (!head.subarray(0, 4).equals(MAGIC)) throw new Error("not a backup file (wrong header)");
    const tag = Buffer.alloc(16);
    await fh.read(tag, 0, 16, size - 16);
    const d = createDecipheriv("aes-256-gcm", key, head.subarray(4, 16));
    d.setAuthTag(tag);
    try {
      await pipeline(createReadStream(src, { start: 16, end: size - 17 }), d, createWriteStream(dest));
    } catch {
      await fs.rm(dest, { force: true }); // never leave unverified plaintext behind
      throw new Error("cannot decrypt the backup: wrong BACKUP_ENCRYPTION_KEY, or the file was changed or damaged");
    }
  } finally {
    await fh.close();
  }
}

/** libpq environment for pg_dump / pg_restore: the password goes in PGPASSWORD, never on the command line. */
export function pgEnv(databaseUrl: string, env = process.env) {
  const u = new URL(databaseUrl);
  const ssl = env.DB_SSL?.trim() || "disable";
  return {
    ...env,
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
    PGSSLMODE: ssl === "verify-full" ? "verify-full" : ssl === "require" ? "require" : "prefer",
    ...(ssl === "verify-full" && env.DB_SSL_CA_FILE ? { PGSSLROOTCERT: env.DB_SSL_CA_FILE } : {}),
  };
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, stdoutTo?: NodeJS.WritableStream) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { env, stdio: ["ignore", stdoutTo ? "pipe" : "ignore", "pipe"] });
    let err = "";
    p.stderr?.on("data", (d) => (err = (err + d).slice(-2000)));
    if (stdoutTo && p.stdout) p.stdout.pipe(stdoutTo);
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}: ${err.trim().split("\n").pop()}`))));
  });
}

export type BackupResult = { key: string; bytes: number; sha256: string; monthly: string | null };
type Deps = { client: S3Client; bucket: string; key: Buffer; databaseUrl: string; pgDump: string; now: Date };

function deps(): Deps {
  const c = config();
  if (!c.BACKUP_BUCKET || !c.BACKUP_ENCRYPTION_KEY) throw new Error("BACKUP_BUCKET and BACKUP_ENCRYPTION_KEY are not set");
  return {
    client: s3Client(s3SettingsFrom(c, c.BACKUP_BUCKET)),
    bucket: c.BACKUP_BUCKET,
    key: Buffer.from(c.BACKUP_ENCRYPTION_KEY, "base64"),
    databaseUrl: c.DATABASE_URL,
    pgDump: c.PG_DUMP_PATH || "pg_dump",
    now: new Date(),
  };
}

/** One backup now. Returns where it went. */
export async function runBackup(over: Partial<Deps> = {}): Promise<BackupResult> {
  const d = { ...deps(), ...over };
  const c = config();
  const day = todayIST(d.now);
  const stamp = d.now.toISOString().replace(/[:.]/g, "-");
  const name = `hirefolios-${stamp}.dump.enc`;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hf-backup-"));
  const file = path.join(tmp, name);
  try {
    const hash = createHash("sha256");
    const enc = encryptStream(d.key);
    const out = createWriteStream(file);
    enc.on("data", (b: Buffer) => hash.update(b));
    const done = pipeline(enc, out);
    await run(d.pgDump, ["--format=custom", "--no-owner", "--no-acl"], pgEnv(d.databaseUrl), enc);
    enc.end();
    await done;
    const { size } = await fs.stat(file);
    const sha256 = hash.digest("hex");
    const key = `daily/${day}/${name}`;
    const sse = c.S3_SSE === "none" ? {} : { ServerSideEncryption: c.S3_SSE };
    await d.client.send(new PutObjectCommand({ Bucket: d.bucket, Key: key, Body: createReadStream(file), ContentLength: size, ContentType: "application/octet-stream", ...sse }));
    const manifest = { key, bytes: size, sha256, createdAt: d.now.toISOString(), appVersion: c.APP_VERSION || pkg.version, format: "pg_dump custom, AES-256-GCM (HFB1)" };
    await d.client.send(new PutObjectCommand({ Bucket: d.bucket, Key: `${key}.json`, Body: JSON.stringify(manifest, null, 2), ContentType: "application/json", ...sse }));
    // first backup of the month: a copy kept for a year (bucket lifecycle on monthly/)
    const month = day.slice(0, 7);
    const have = await d.client.send(new ListObjectsV2Command({ Bucket: d.bucket, Prefix: `monthly/${month}/`, MaxKeys: 1 }));
    let monthly: string | null = null;
    if (!have.KeyCount) {
      monthly = `monthly/${month}/${name}`;
      for (const [from, to] of [[key, monthly], [`${key}.json`, `${monthly}.json`]]) {
        await d.client.send(new CopyObjectCommand({ Bucket: d.bucket, CopySource: `${d.bucket}/${from}`, Key: to, ...sse }));
      }
    }
    await d.client.send(new PutObjectCommand({ Bucket: d.bucket, Key: "status/last-backup.json", Body: JSON.stringify({ at: d.now.toISOString(), key, bytes: size }), ContentType: "application/json", ...sse }));
    log.info("backup.done", { bytes: size, monthly: monthly !== null });
    return { key, bytes: size, sha256, monthly };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** Newest daily backup key, or null. */
export async function latestBackupKey(over: Partial<Deps> = {}) {
  const d = { ...deps(), ...over };
  let best: string | null = null;
  let token: string | undefined;
  do {
    const r = await d.client.send(new ListObjectsV2Command({ Bucket: d.bucket, Prefix: "daily/", ContinuationToken: token }));
    for (const o of r.Contents ?? []) if (o.Key?.endsWith(".dump.enc") && (!best || o.Key > best)) best = o.Key;
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return best;
}

/**
 * Restores a backup into the database at `targetUrl` (default DATABASE_URL): download, check the manifest's SHA-256,
 * decrypt (a wrong key or a changed file stops here), then pg_restore --clean. The app must be stopped first.
 */
export async function restoreBackup(objectKey: string, o: { targetUrl?: string; pgRestore?: string } & Partial<Deps> = {}) {
  const d = { ...deps(), ...o };
  const c = config();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hf-restore-"));
  try {
    const enc = path.join(tmp, "backup.enc");
    const r = await d.client.send(new GetObjectCommand({ Bucket: d.bucket, Key: objectKey }));
    await pipeline(r.Body as NodeJS.ReadableStream, createWriteStream(enc));
    const m = await d.client.send(new GetObjectCommand({ Bucket: d.bucket, Key: `${objectKey}.json` }));
    const manifest = JSON.parse(await m.Body!.transformToString()) as { sha256: string; bytes: number };
    const sha = createHash("sha256").update(await fs.readFile(enc)).digest("hex");
    if (sha !== manifest.sha256) throw new Error("backup checksum does not match its manifest: the file is damaged");
    const dump = path.join(tmp, "backup.dump");
    await decryptFile(enc, dump, d.key);
    const env = pgEnv(o.targetUrl ?? d.databaseUrl); // host, user and password from the environment, never the command line
    await run(o.pgRestore || c.PG_RESTORE_PATH || "pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-acl", "--single-transaction", "--dbname", env.PGDATABASE, dump], env);
    return { sha256: sha, bytes: manifest.bytes };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** Time of the last successful backup (status/last-backup.json), cached for 5 minutes for /api/health. */
let statusCache: { at: number; value: string | null } | null = null;
export async function lastS3BackupAt(): Promise<string | null> {
  if (statusCache && Date.now() - statusCache.at < 5 * 60_000) return statusCache.value;
  let value: string | null = null;
  try {
    const d = deps();
    const r = await d.client.send(new GetObjectCommand({ Bucket: d.bucket, Key: "status/last-backup.json" }));
    value = (JSON.parse(await r.Body!.transformToString()) as { at: string }).at;
  } catch {
    value = null;
  }
  statusCache = { at: Date.now(), value };
  return value;
}

// ---------- nightly scheduler (in the app; one instance runs it, guarded by an advisory lock) ----------

const BACKUP_LOCK = 7_031_965_407;
const g = globalThis as unknown as { backupTimer?: ReturnType<typeof setInterval>; backupRunning?: boolean };

/** Due when it is past BACKUP_TIME (India time) and today's backup is not done yet. */
export function backupDue(now: Date, time: string, lastAt: string | null) {
  const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  if (hhmm < time) return false;
  return !lastAt || todayIST(new Date(lastAt)) !== todayIST(now);
}

async function tick() {
  if (g.backupRunning) return;
  g.backupRunning = true;
  const c = config();
  const lock = postgres(c.DATABASE_URL, { ...dbOptions(), max: 1 });
  try {
    statusCache = null;
    if (!backupDue(new Date(), c.BACKUP_TIME, await lastS3BackupAt())) return;
    const [{ ok }] = await lock<{ ok: boolean }[]>`select pg_try_advisory_lock(${BACKUP_LOCK}) as ok`;
    if (!ok) return; // another instance is backing up
    try {
      await runBackup();
      statusCache = null;
    } finally {
      await lock`select pg_advisory_unlock(${BACKUP_LOCK})`;
    }
  } catch (e) {
    log.error("backup.failed", { reason: (e as Error).message });
  } finally {
    await lock.end().catch(() => {});
    g.backupRunning = false;
  }
}

export function startBackupScheduler() {
  if (g.backupTimer) return;
  log.info("backup.scheduled", { at: config().BACKUP_TIME });
  g.backupTimer = setInterval(tick, 10 * 60_000);
  setTimeout(tick, 60_000);
}
