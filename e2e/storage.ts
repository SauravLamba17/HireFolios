// Test helper: put / check / remove files in the same storage the server under test uses (STORAGE_DRIVER=local: the
// UPLOAD_DIR folder; s3: the S3_BUCKET bucket via the S3_* settings). Tests make their own rows and files with it.
import fs from "node:fs";
import path from "node:path";
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const e = process.env;
const s3 = e.STORAGE_DRIVER === "s3";
const client = s3 ? new S3Client({ region: e.S3_REGION || "ap-south-1", endpoint: e.S3_ENDPOINT || undefined, forcePathStyle: e.S3_FORCE_PATH_STYLE === "1" }) : null;
const Bucket = e.S3_BUCKET!;
const root = () => {
  if (!e.UPLOAD_DIR || !path.isAbsolute(e.UPLOAD_DIR)) throw new Error("UPLOAD_DIR must be an absolute folder (STORAGE_DRIVER=local)");
  return e.UPLOAD_DIR;
};

export const storageDriver = s3 ? "s3" : "local";

export async function putFile(key: string, data: Uint8Array, type = "image/jpeg") {
  if (client) {
    await client.send(new PutObjectCommand({ Bucket, Key: key, Body: data, ContentType: type, ...(e.S3_SSE === "none" ? {} : { ServerSideEncryption: "AES256" }) }));
    return;
  }
  fs.mkdirSync(path.dirname(path.join(root(), key)), { recursive: true });
  fs.writeFileSync(path.join(root(), key), data);
}

export async function fileExists(key: string) {
  if (client) {
    try {
      await client.send(new GetObjectCommand({ Bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
  return fs.existsSync(path.join(root(), key));
}

/** Every key under a prefix ("<tenant>/" or "<tenant>/<candidate>/"). */
export async function listFiles(prefix: string) {
  if (client) {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const r = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of r.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }
  const dir = path.join(root(), prefix);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(root(), path.join(d.parentPath, d.name)).split(path.sep).join("/"));
}

export async function removeFiles(prefix: string) {
  if (client) {
    const keys = await listFiles(prefix);
    for (let i = 0; i < keys.length; i += 1000) await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true } }));
    return;
  }
  fs.rmSync(path.join(root(), prefix), { recursive: true, force: true });
}
