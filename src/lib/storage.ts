// File storage for candidate photos, CVs and company logos (CLAUDE.md hard rule 3: never public).
// Two drivers behind one interface, chosen by STORAGE_DRIVER: "local" (a folder, UPLOAD_DIR: the office PC) and "s3"
// (an S3 bucket, AWS or any S3-compatible server: AWS deploy). Keys are always "<tenant>/<candidate or company>/<file>".
// Files leave storage only through GET /api/files/[id] and /api/company/logo after the login + tenant checks: the
// app streams them, or (S3_SIGNED_URLS=on) answers with a short-lived signed URL.
import "server-only";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type ServerSideEncryption,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "@/lib/config";

export type Stored = { key: string; size: number };
export type StreamResult = { body: ReadableStream<Uint8Array>; size: number | null };

export interface Storage {
  readonly driver: "local" | "s3";
  /** Writes a new object. Local never overwrites (keys are random); S3 writes with server-side encryption. */
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  /** Whole object, or null when it does not exist. */
  get(key: string): Promise<Uint8Array | null>;
  /** Streamed object (large CV files), or null. */
  stream(key: string): Promise<StreamResult | null>;
  /** Deletes these keys (missing ones are fine). Returns how many were asked for. */
  delete(keys: string[]): Promise<number>;
  /** Every object under a prefix (e.g. "<tenant>/"). */
  list(prefix: string): AsyncIterable<Stored>;
  /** Short-lived URL to the object (S3 with S3_SIGNED_URLS=on), or null: the caller streams it instead. */
  signedUrl(key: string, o: { contentType: string; disposition: string }): Promise<string | null>;
  /** For /api/health: can we reach the storage? */
  check(): Promise<{ ok: boolean; detail: string }>;
}

const safeKey = (key: string) => {
  // keys are made by the app; refuse anything that could leave the root
  if (!/^[\w-]+(\/[\w.-]+)+$/.test(key) || key.includes("..")) throw new Error("invalid storage key");
  return key;
};

// ---------- local folder ----------

export class LocalStorage implements Storage {
  readonly driver = "local" as const;
  constructor(readonly root: string) {}
  private full(key: string) {
    return path.join(this.root, safeKey(key));
  }
  async put(key: string, data: Uint8Array, _contentType?: string) { // eslint-disable-line @typescript-eslint/no-unused-vars -- a folder keeps no type
    const full = this.full(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data, { flag: "wx" });
  }
  async get(key: string) {
    return fs.readFile(this.full(key)).then((b) => new Uint8Array(b), () => null);
  }
  async stream(key: string) {
    const full = this.full(key);
    const st = await fs.stat(full).catch(() => null);
    if (!st?.isFile()) return null;
    return { body: Readable.toWeb(createReadStream(full)) as ReadableStream<Uint8Array>, size: st.size };
  }
  async delete(keys: string[]) {
    for (const key of keys) await fs.rm(this.full(key), { force: true });
    // tidy now-empty candidate folders
    for (const d of new Set(keys.map((k) => path.dirname(this.full(k))))) await fs.rmdir(d).catch(() => {});
    return keys.length;
  }
  async *list(prefix: string): AsyncIterable<Stored> {
    const base = path.join(this.root, prefix);
    const walk = async function* (dir: string): AsyncGenerator<string> {
      for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) yield* walk(p);
        else if (e.isFile() && !e.name.startsWith(".")) yield p;
      }
    };
    for await (const p of walk(base)) yield { key: path.relative(this.root, p).split(path.sep).join("/"), size: (await fs.stat(p)).size };
  }
  async signedUrl() {
    return null;
  }
  async check() {
    try {
      await fs.mkdir(this.root, { recursive: true });
      await fs.access(this.root, fs.constants.W_OK);
      return { ok: true, detail: "folder" };
    } catch {
      return { ok: false, detail: "folder not writable" };
    }
  }
}

// ---------- S3 (AWS, or any S3-compatible server for testing) ----------

export type S3Settings = {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  sse: "AES256" | "aws:kms" | "none";
  signedUrls: boolean;
  signedUrlSeconds: number;
};

export function s3Client(s: Pick<S3Settings, "region" | "endpoint" | "forcePathStyle">) {
  // Credentials: the AWS SDK's default chain (an IAM role on EC2, or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in the
  // server's environment file). They are never read or logged by the app.
  return new S3Client({
    region: s.region,
    endpoint: s.endpoint,
    forcePathStyle: s.forcePathStyle,
    maxAttempts: 3, // retries with back-off: a short network blip during intake does not lose the save
    // never hang an intake (it holds a database transaction) on an unreachable or stalled S3
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
  });
}

const notFound = (e: unknown) => {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err?.name === "NoSuchKey" || err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404;
};

export class S3Storage implements Storage {
  readonly driver = "s3" as const;
  readonly client: S3Client;
  constructor(readonly s: S3Settings, client?: S3Client) {
    this.client = client ?? s3Client(s);
  }
  async put(key: string, data: Uint8Array, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.s.bucket,
        Key: safeKey(key),
        Body: data,
        ContentType: contentType,
        ...(this.s.sse === "none" ? {} : { ServerSideEncryption: this.s.sse as ServerSideEncryption }),
      }),
    );
  }
  async get(key: string) {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.s.bucket, Key: safeKey(key) }));
      return r.Body ? new Uint8Array(await r.Body.transformToByteArray()) : null;
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
  }
  async stream(key: string) {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.s.bucket, Key: safeKey(key) }));
      if (!r.Body) return null;
      return { body: r.Body.transformToWebStream() as ReadableStream<Uint8Array>, size: r.ContentLength ?? null };
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
  }
  async delete(keys: string[]) {
    for (let i = 0; i < keys.length; i += 1000) {
      const part = keys.slice(i, i + 1000);
      const r = await this.client.send(new DeleteObjectsCommand({ Bucket: this.s.bucket, Delete: { Objects: part.map((Key) => ({ Key: safeKey(Key) })), Quiet: true } }));
      if (r.Errors?.length) throw new Error(`storage: ${r.Errors.length} objects could not be deleted (${r.Errors[0].Code})`);
    }
    return keys.length;
  }
  async *list(prefix: string): AsyncIterable<Stored> {
    let token: string | undefined;
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.s.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of r.Contents ?? []) if (o.Key) yield { key: o.Key, size: o.Size ?? 0 };
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
  }
  async signedUrl(key: string, o: { contentType: string; disposition: string }) {
    if (!this.s.signedUrls) return null;
    const cmd = new GetObjectCommand({ Bucket: this.s.bucket, Key: safeKey(key), ResponseContentType: o.contentType, ResponseContentDisposition: o.disposition });
    return getSignedUrl(this.client, cmd, { expiresIn: this.s.signedUrlSeconds });
  }
  async check() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.s.bucket }));
      return { ok: true, detail: "bucket" };
    } catch (e) {
      return { ok: false, detail: (e as { name?: string }).name ?? "unreachable" };
    }
  }
}

// ---------- the configured storage of this process ----------

export function s3SettingsFrom(c: ReturnType<typeof config>, bucket = c.S3_BUCKET!): S3Settings {
  return {
    bucket,
    region: c.S3_REGION,
    endpoint: c.S3_ENDPOINT,
    forcePathStyle: c.S3_FORCE_PATH_STYLE === "1",
    sse: c.S3_SSE,
    signedUrls: c.S3_SIGNED_URLS === "on",
    signedUrlSeconds: c.S3_SIGNED_URL_SECONDS,
  };
}

const g = globalThis as unknown as { appStorage?: Storage };
/** The storage this server uses (STORAGE_DRIVER), made once per process. */
export function storage(): Storage {
  if (g.appStorage) return g.appStorage;
  const c = config();
  g.appStorage = c.STORAGE_DRIVER === "s3" ? new S3Storage(s3SettingsFrom(c)) : new LocalStorage(path.resolve(c.UPLOAD_DIR!));
  return g.appStorage;
}
