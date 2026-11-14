// Server health for /api/health (uptime checks, load balancer / Lightsail health check, the container HEALTHCHECK) and
// the admin status card. No personal data, no bucket names, keys or addresses.
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { lastS3BackupAt } from "@/lib/backup";
import { config } from "@/lib/config";
import { uploadRoot } from "@/lib/files";
import { storage } from "@/lib/storage";
import pkg from "../../package.json";

/** deploy/windows/backup.ps1 writes the finish time here; default: UPLOAD_DIR/.last-backup */
export const backupStatusFile = () => process.env.BACKUP_STATUS_FILE || (uploadRoot() ? path.join(uploadRoot()!, ".last-backup") : null);

const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

export async function systemStatus() {
  const c = config();
  const [db_ok, store] = await Promise.all([
    withTimeout(
      db.execute(sql`select 1`).then(
        () => true,
        () => false,
      ),
      5000,
      false,
    ),
    withTimeout(storage().check(), 5000, { ok: false, detail: "timeout" }),
  ]);
  // free disk where this server writes: the uploads folder (office PC), or the app's own folder (AWS: logs, temp files)
  let freeBytes: number | null = null;
  try {
    const s = await fs.statfs(c.STORAGE_DRIVER === "local" ? uploadRoot()! : process.cwd());
    freeBytes = Number(s.bavail) * Number(s.bsize);
  } catch {
    freeBytes = null; // folder missing or not mounted
  }
  let lastBackupAt: string | null = null;
  if (c.BACKUP_BUCKET) lastBackupAt = await withTimeout(lastS3BackupAt(), 5000, null);
  else {
    const f = backupStatusFile();
    if (f) {
      const text = await fs.readFile(f, "utf8").catch(() => "");
      const d = new Date(text.trim());
      if (!Number.isNaN(d.getTime())) lastBackupAt = d.toISOString();
    }
  }
  const freeGB = freeBytes === null ? null : Math.round((freeBytes / 1024 ** 3) * 10) / 10;
  return {
    status: db_ok && store.ok && freeBytes !== null ? "ok" : "degraded",
    version: process.env.APP_VERSION || pkg.version,
    database: db_ok,
    storage: { driver: c.STORAGE_DRIVER, ok: store.ok },
    // kept for the status card and older checks: "uploads" = the file storage
    uploads: { configured: c.STORAGE_DRIVER === "s3" || uploadRoot() !== null, freeBytes, freeGB },
    disk: { freeGB },
    lastBackupAt,
    time: new Date().toISOString(),
  };
}
