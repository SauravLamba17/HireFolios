// Phase 5 (AWS-ready): client address, IP allow-list, API rate limiter, security headers, backup encryption,
// configuration of storage / database / security, local storage driver.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { clientIp, ipAllowed, parseAllowList, RateLimiter, validEntry } from "./net";
import { parseConfig } from "./config";
import { contentSecurityPolicy } from "../middleware";

vi.mock("@/db", () => ({ dbOptions: () => ({}) }));
const { backupDue, decryptFile, encryptStream, pgEnv } = await import("./backup");
const { LocalStorage } = await import("./storage");

describe("client address behind Caddy", () => {
  it("uses the last X-Forwarded-For entry (the one the proxy wrote)", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "x-forwarded-for": "::ffff:198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(new Headers())).toBeNull(); // no proxy: unknown
  });
});

describe("office IP allow-list", () => {
  const list = ["203.0.113.0/24", "198.51.100.7", "2001:db8::1"];
  it("matches addresses, ranges and IPv6 exactly", () => {
    expect(ipAllowed("203.0.113.200", list)).toBe(true);
    expect(ipAllowed("203.0.114.1", list)).toBe(false);
    expect(ipAllowed("198.51.100.7", list)).toBe(true);
    expect(ipAllowed("198.51.100.8", list)).toBe(false);
    expect(ipAllowed("2001:DB8::1", list)).toBe(true);
    expect(ipAllowed(null, list)).toBe(false); // unknown address: fails closed
    expect(ipAllowed("10.0.0.1", ["0.0.0.0/0"])).toBe(true);
  });
  it("checks entries and cleans the form text", () => {
    expect(["1.2.3.4", "1.2.3.0/24", "fe80::1"].every(validEntry)).toBe(true);
    expect(["1.2.3", "1.2.3.4/33", "999.1.1.1", "abc", "1.2.3.4/24/1", ""].some(validEntry)).toBe(false);
    expect(parseAllowList(" 1.2.3.4 # office\n\n# old\n5.6.7.8/30 ")).toEqual(["1.2.3.4", "5.6.7.8/30"]);
  });
});

describe("API rate limiter", () => {
  it("allows up to the limit per key in the window, then refuses until it slides", () => {
    const l = new RateLimiter(3, 60_000);
    expect([0, 1, 2, 3].map((i) => l.hit("u1", 1000 + i))).toEqual([true, true, true, false]);
    expect(l.hit("u2", 1005)).toBe(true); // per person
    expect(l.hit("u1", 61_001)).toBe(true); // the first hits left the window
  });
});

describe("security headers", () => {
  it("CSP: nonce scripts only, no framing, no plugins; S3 origin only when signed URLs are used", () => {
    const csp = contentSecurityPolicy("abc", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("img-src 'self' data: blob:;");
    expect(contentSecurityPolicy("abc", false, "https://b.s3.ap-south-1.amazonaws.com")).toContain("img-src 'self' data: blob: https://b.s3.ap-south-1.amazonaws.com");
    expect(contentSecurityPolicy("abc", true)).toContain("'unsafe-eval'"); // next dev only
  });
});

describe("backups", () => {
  it("encrypt → decrypt round trip; a wrong key or a changed byte is refused", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hf-enc-"));
    try {
      const key = randomBytes(32);
      const plain = randomBytes(300_000);
      const enc = path.join(dir, "b.enc");
      await pipeline(Readable.from([plain.subarray(0, 1000), plain.subarray(1000)]), encryptStream(key), createWriteStream(enc));
      const out = path.join(dir, "b.dump");
      await decryptFile(enc, out, key);
      expect(Buffer.compare(await fs.readFile(out), plain)).toBe(0);
      await expect(decryptFile(enc, path.join(dir, "x"), randomBytes(32))).rejects.toThrow(/wrong BACKUP_ENCRYPTION_KEY/);
      await expect(fs.access(path.join(dir, "x"))).rejects.toThrow(); // no unverified plaintext left behind
      const bytes = await fs.readFile(enc);
      bytes[5000] ^= 1;
      await fs.writeFile(enc, bytes);
      await expect(decryptFile(enc, path.join(dir, "y"), key)).rejects.toThrow();
      await fs.writeFile(enc, Buffer.from("not a backup at all, long enough to read"));
      await expect(decryptFile(enc, path.join(dir, "z"), key)).rejects.toThrow(/header/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
  it("passes the database password in the environment, never in arguments", () => {
    const e = pgEnv("postgres://hf%40user:p%40ss@db.example:6543/hf_db", { DB_SSL: "verify-full", DB_SSL_CA_FILE: "/ca.pem" } as unknown as NodeJS.ProcessEnv);
    expect(e).toMatchObject({ PGHOST: "db.example", PGPORT: "6543", PGUSER: "hf@user", PGPASSWORD: "p@ss", PGDATABASE: "hf_db", PGSSLMODE: "verify-full", PGSSLROOTCERT: "/ca.pem" });
  });
  it("is due once a day after BACKUP_TIME (India time)", () => {
    const at = (s: string) => new Date(`${s}+05:30`);
    expect(backupDue(at("2026-11-14T02:00:00"), "02:30", null)).toBe(false);
    expect(backupDue(at("2026-11-14T02:31:00"), "02:30", null)).toBe(true);
    expect(backupDue(at("2026-11-14T09:00:00"), "02:30", at("2026-11-14T02:31:00").toISOString())).toBe(false);
    expect(backupDue(at("2026-11-15T02:40:00"), "02:30", at("2026-11-14T02:31:00").toISOString())).toBe(true);
  });
});

describe("configuration for AWS", () => {
  const base = { DATABASE_URL: "postgres://u:p@db:5432/hf", BETTER_AUTH_URL: "https://simplen.hirefolios.in", BETTER_AUTH_SECRET: "s".repeat(32) };
  const problems = (env: Record<string, string>) => {
    try {
      parseConfig(env);
      return [];
    } catch (e) {
      return (e as { problems: string[] }).problems;
    }
  };
  it("S3 storage needs a bucket, not UPLOAD_DIR; backups need a key and their own bucket", () => {
    expect(problems({ ...base, STORAGE_DRIVER: "s3" })).toEqual(["S3_BUCKET is required when STORAGE_DRIVER=s3"]);
    const c = parseConfig({ ...base, STORAGE_DRIVER: "s3", S3_BUCKET: "hirefolios-simplen-uploads" });
    expect([c.S3_REGION, c.S3_SSE, c.S3_SIGNED_URLS, c.DB_SSL, c.DB_POOL_MAX, c.LOCKOUT_ATTEMPTS]).toEqual(["ap-south-1", "AES256", "off", "disable", 10, 5]);
    expect(problems({ ...base, UPLOAD_DIR: path.resolve("/x"), BACKUP_BUCKET: "hf-backups" })).toEqual(["BACKUP_ENCRYPTION_KEY is required when BACKUP_BUCKET is set (backups are encrypted)"]);
    expect(problems({ ...base, STORAGE_DRIVER: "s3", S3_BUCKET: "same-bucket", BACKUP_BUCKET: "same-bucket", BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64") })).toEqual([
      "BACKUP_BUCKET must be a different bucket from S3_BUCKET",
    ]);
    expect(problems({ ...base, UPLOAD_DIR: path.resolve("/x"), BACKUP_BUCKET: "hf-backups", BACKUP_ENCRYPTION_KEY: "short" })[0]).toMatch(/BACKUP_ENCRYPTION_KEY must be 32 random bytes/);
  });
  it("TLS to a managed database, roles that must use two-factor, sign-in limit format", () => {
    expect(problems({ ...base, UPLOAD_DIR: path.resolve("/x"), DB_SSL: "verify-full" })).toEqual(["DB_SSL_CA_FILE is required when DB_SSL=verify-full"]);
    expect(problems({ ...base, UPLOAD_DIR: path.resolve("/x"), TWO_FACTOR_REQUIRED_ROLES: "admin,hr,boss" })[0]).toMatch(/TWO_FACTOR_REQUIRED_ROLES/);
    expect(problems({ ...base, UPLOAD_DIR: path.resolve("/x"), SIGN_IN_LIMIT: "lots" })[0]).toMatch(/SIGN_IN_LIMIT/);
    expect(problems({ ...base, UPLOAD_DIR: path.resolve("/x"), S3_REGION: "mumbai" })[0]).toMatch(/S3_REGION/);
  });
});

describe("local storage driver", () => {
  it("put / get / stream / list / delete under its folder, never outside", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hf-store-"));
    try {
      const s = new LocalStorage(root);
      await s.put("t1/c1/f1.jpg", new Uint8Array([1, 2, 3]), "image/jpeg");
      await expect(s.put("t1/c1/f1.jpg", new Uint8Array([9]), "image/jpeg")).rejects.toThrow(); // never overwrites
      expect([...(await s.get("t1/c1/f1.jpg"))!]).toEqual([1, 2, 3]);
      expect(await s.get("t1/c1/none.jpg")).toBeNull();
      const st = await s.stream("t1/c1/f1.jpg");
      expect(st?.size).toBe(3);
      await st?.body.cancel();
      const keys: string[] = [];
      for await (const o of s.list("t1/")) keys.push(o.key);
      expect(keys).toEqual(["t1/c1/f1.jpg"]);
      await expect(s.get("../outside.txt")).rejects.toThrow(/invalid storage key/);
      expect(await s.delete(["t1/c1/f1.jpg"])).toBe(1);
      expect(await s.get("t1/c1/f1.jpg")).toBeNull();
      expect(await s.signedUrl()).toBeNull(); // always streamed by the app
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
