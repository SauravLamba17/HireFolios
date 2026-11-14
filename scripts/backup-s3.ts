// Database backup to S3 now (the server also does it every night at BACKUP_TIME when BACKUP_BUCKET is set), and restore.
//   npm run backup:s3                                   → one encrypted backup into BACKUP_BUCKET
//   npm run backup:s3 -- --list                         → the backups in the bucket (daily/ then monthly/, oldest first)
//   npm run backup:s3 -- --restore latest --yes         → restore the newest daily backup into DATABASE_URL
//   npm run backup:s3 -- --restore <key> --yes          → restore that backup (stop the app first!)
// Needs DATABASE_URL, BACKUP_BUCKET, BACKUP_ENCRYPTION_KEY and the S3 settings; pg_dump / pg_restore 16 on the PATH or
// in PG_DUMP_PATH / PG_RESTORE_PATH. Prints no passwords or keys.
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { pgClient } from "@/db";
import { latestBackupKey, restoreBackup, runBackup } from "@/lib/backup";
import { config } from "@/lib/config";
import { s3Client, s3SettingsFrom } from "@/lib/storage";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const c = config();
  if (!c.BACKUP_BUCKET) throw new Error("BACKUP_BUCKET is not set.");
  if (process.argv.includes("--list")) {
    const client = s3Client(s3SettingsFrom(c, c.BACKUP_BUCKET));
    let token: string | undefined;
    do {
      const r = await client.send(new ListObjectsV2Command({ Bucket: c.BACKUP_BUCKET, ContinuationToken: token }));
      for (const o of r.Contents ?? []) if (o.Key?.endsWith(".dump.enc")) console.log(`${o.Key}  ${((o.Size ?? 0) / 1024 ** 2).toFixed(2)} MB`);
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return;
  }
  const restore = arg("--restore");
  if (restore) {
    if (!process.argv.includes("--yes")) throw new Error("Restoring replaces the whole database. Stop the app, then add --yes to confirm.");
    const key = restore === "latest" ? await latestBackupKey() : restore;
    if (!key) throw new Error("No backup found in the bucket.");
    console.log(`restoring ${key} …`);
    const r = await restoreBackup(key);
    console.log(`restored (${(r.bytes / 1024 ** 2).toFixed(2)} MB, checksum ${r.sha256.slice(0, 12)}… verified). Start the app again.`);
    return;
  }
  const r = await runBackup();
  console.log(`backup done: ${r.key} (${(r.bytes / 1024 ** 2).toFixed(2)} MB)${r.monthly ? `, kept as the monthly copy ${r.monthly}` : ""}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
