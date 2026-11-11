// Server health for /api/health and the admin status card. No personal data.
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { uploadRoot } from "@/lib/files";
import pkg from "../../package.json";

/** deploy/windows/backup.ps1 writes the finish time here; default: UPLOAD_DIR/.last-backup */
export const backupStatusFile = () => process.env.BACKUP_STATUS_FILE || (uploadRoot() ? path.join(uploadRoot()!, ".last-backup") : null);

export async function systemStatus() {
  const db_ok = await db
    .execute(sql`select 1`)
    .then(() => true)
    .catch(() => false);
  const root = uploadRoot();
  let freeBytes: number | null = null;
  if (root) {
    try {
      const s = await fs.statfs(root);
      freeBytes = Number(s.bavail) * Number(s.bsize);
    } catch {
      freeBytes = null; // folder missing or not mounted
    }
  }
  let lastBackupAt: string | null = null;
  const f = backupStatusFile();
  if (f) {
    const text = await fs.readFile(f, "utf8").catch(() => "");
    const d = new Date(text.trim());
    if (!Number.isNaN(d.getTime())) lastBackupAt = d.toISOString();
  }
  return {
    status: db_ok && freeBytes !== null ? "ok" : "degraded",
    version: process.env.APP_VERSION || pkg.version,
    database: db_ok,
    uploads: { configured: root !== null, freeBytes, freeGB: freeBytes === null ? null : Math.round((freeBytes / 1024 ** 3) * 10) / 10 },
    lastBackupAt,
    time: new Date().toISOString(),
  };
}
