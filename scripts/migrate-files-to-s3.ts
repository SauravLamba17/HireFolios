// Copy the files of a local install (UPLOAD_DIR) to the S3 bucket (S3_BUCKET), keeping the same keys, and check every
// copy byte for byte (SHA-256). Nothing is deleted locally. Dry run unless --apply.
//   npm run files:to-s3              → what would be copied (and what is missing), nothing written
//   npm run files:to-s3 -- --apply   → copy, read back, compare checksums; safe to run again (already-equal objects are skipped)
// Needs UPLOAD_DIR (the source folder) and the S3_* settings; STORAGE_DRIVER may still be "local" while you migrate.
import path from "node:path";
import { createHash } from "node:crypto";
import { isNotNull, isNull } from "drizzle-orm";
import { db, pgClient } from "@/db";
import * as s from "@/db/schema";
import { config } from "@/lib/config";
import { LocalStorage, S3Storage, s3SettingsFrom } from "@/lib/storage";

const apply = process.argv.includes("--apply");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function main() {
  const c = config();
  if (!c.UPLOAD_DIR) throw new Error("UPLOAD_DIR (the folder to copy from) is not set.");
  if (!c.S3_BUCKET) throw new Error("S3_BUCKET (the bucket to copy to) is not set.");
  const from = new LocalStorage(path.resolve(c.UPLOAD_DIR));
  const to = new S3Storage(s3SettingsFrom(c));
  const reach = await to.check();
  if (!reach.ok) throw new Error(`The bucket is not reachable (${reach.detail}). Check S3_BUCKET, S3_REGION and the credentials.`);

  // every file the database knows: candidate files not yet purged, and company logos
  const files = await db.select({ key: s.candidateFiles.storageKey, type: s.candidateFiles.mimeType, sha256: s.candidateFiles.sha256 }).from(s.candidateFiles).where(isNull(s.candidateFiles.deletedAt));
  const logos = await db.select({ key: s.tenants.logoKey, type: s.tenants.logoType }).from(s.tenants).where(isNotNull(s.tenants.logoKey));
  const all = [...files, ...logos.map((l) => ({ key: l.key!, type: l.type ?? "application/octet-stream", sha256: null }))];

  const n = { total: all.length, copy: 0, same: 0, missing: 0, damaged: 0, copied: 0, verified: 0, failed: 0, bytes: 0 };
  for (const f of all) {
    const data = await from.get(f.key);
    if (!data) {
      n.missing++;
      console.log(`MISSING locally: ${f.key.split("/")[0]}/… (row has no file)`); // tenant id only, no candidate id
      continue;
    }
    const local = sha(data);
    if (f.sha256 && f.sha256 !== local) {
      n.damaged++;
      console.log(`CHECKSUM differs from the database for a file of tenant ${f.key.split("/")[0]}: copied anyway, check it`);
    }
    const there = await to.get(f.key);
    if (there && sha(there) === local) {
      n.same++;
      continue;
    }
    n.copy++;
    n.bytes += data.byteLength;
    if (!apply) continue;
    try {
      await to.put(f.key, data, f.type);
      const back = await to.get(f.key);
      if (!back || sha(back) !== local) throw new Error("read-back checksum differs");
      n.copied++;
      n.verified++;
    } catch (e) {
      n.failed++;
      console.log(`FAILED: a file of tenant ${f.key.split("/")[0]}: ${(e as Error).message}`);
    }
  }
  console.log(
    apply
      ? `\ncopied and verified ${n.verified} of ${n.copy} files (${(n.bytes / 1024 ** 2).toFixed(1)} MB); already in the bucket: ${n.same}; missing locally: ${n.missing}; failed: ${n.failed}`
      : `\nDRY RUN: ${n.copy} of ${n.total} files would be copied (${(n.bytes / 1024 ** 2).toFixed(1)} MB); already in the bucket: ${n.same}; missing locally: ${n.missing}. Run again with --apply to copy.`,
  );
  if (n.damaged) console.log(`${n.damaged} files differ from the checksum saved at intake (copied as they are).`);
  process.exitCode = n.failed ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
