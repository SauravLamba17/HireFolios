import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { isSupportedBrowser } from "./browser";
import { ConfigError, inOfficeHours, parseConfig } from "./config";
import { nodeVersionProblem, PINNED, postgresVersionProblem } from "./runtime-check";

const ok = {
  DATABASE_URL: "postgres://hf:secret@127.0.0.1:5432/hirefolios",
  UPLOAD_DIR: process.platform === "win32" ? "C:\\hirefolios-data\\uploads" : "/srv/uploads",
  BETTER_AUTH_URL: "https://simplen.hirefolios.in",
  BETTER_AUTH_SECRET: "x".repeat(64),
};
const problems = (env: Record<string, string | undefined>) => {
  try {
    parseConfig(env);
    return [];
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return (e as ConfigError).problems;
  }
};

describe("configuration (.env) checked at start-up", () => {
  it("a complete .env passes, with safe defaults", () => {
    const c = parseConfig(ok);
    expect(c).toMatchObject({ STAFF_SESSION_HOURS: 12, DISPLAY_SESSION_DAYS: 30, MAX_UPLOAD_MB: 8, MAX_CV_FILES: 5, MAX_CV_PAGES: 10, PURGE_JOB: "on", PURGE_INTERVAL_MINUTES: 30, RUN_MIGRATIONS: "0" });
    expect(c.OFFICE_HOURS).toBeUndefined();
  });

  it.each([
    ["DATABASE_URL", undefined, /DATABASE_URL is required/],
    ["DATABASE_URL", "mysql://x@y/z", /DATABASE_URL must look like postgres:\/\//],
    ["UPLOAD_DIR", undefined, /UPLOAD_DIR is required/],
    ["UPLOAD_DIR", "uploads", /UPLOAD_DIR must be an absolute folder path/],
    ["BETTER_AUTH_URL", "simplen.hirefolios.in", /BETTER_AUTH_URL must be an address like https:/],
    ["BETTER_AUTH_URL", "https://simplen.hirefolios.in/login", /no path/],
    ["BETTER_AUTH_SECRET", "short", /BETTER_AUTH_SECRET must be at least 32 characters/],
    ["PORT", "80a", /PORT must be a whole number/],
    ["PORT", "70000", /PORT must be 1 to 65535/],
    ["STAFF_SESSION_HOURS", "48", /STAFF_SESSION_HOURS must be 1 to 24/],
    ["MAX_UPLOAD_MB", "0", /MAX_UPLOAD_MB must be 1 to 25/],
    ["OFFICE_HOURS", "9-7", /OFFICE_HOURS must look like 09:00-19:00/],
    ["PURGE_JOB", "maybe", /PURGE_JOB must be on or off/],
    ["BACKUP_DIR", "backups", /BACKUP_DIR must be an absolute folder path/],
    ["BETTER_AUTH_TRUSTED_ORIGINS", "192.168.1.20", /BETTER_AUTH_TRUSTED_ORIGINS must be addresses/],
  ])("%s=%s stops the start with a message naming the variable", (key, value, msg) => {
    const p = problems({ ...ok, [key]: value });
    expect(p.join("\n")).toMatch(msg);
    expect(p.join("\n")).toContain(key);
  });

  it("lists every problem at once", () => {
    expect(problems({}).length).toBeGreaterThanOrEqual(4);
  });

  it("empty optional values count as not set", () => {
    expect(parseConfig({ ...ok, BACKUP_DIR: "", OFFICE_HOURS: " ", PORT: "" }).BACKUP_DIR).toBeUndefined();
  });
});

describe("deletion job office hours (India time)", () => {
  const at = (hhmm: string) => new Date(`2026-11-12T${hhmm}:00+05:30`);
  it("waits inside the hours, runs outside, across midnight too", () => {
    expect(inOfficeHours(at("10:00"), "09:00-19:00")).toBe(true);
    expect(inOfficeHours(at("19:00"), "09:00-19:00")).toBe(false);
    expect(inOfficeHours(at("08:59"), "09:00-19:00")).toBe(false);
    expect(inOfficeHours(at("23:30"), "22:00-06:00")).toBe(true);
    expect(inOfficeHours(at("05:00"), "22:00-06:00")).toBe(true);
    expect(inOfficeHours(at("12:00"), "22:00-06:00")).toBe(false);
    expect(inOfficeHours(at("12:00"), undefined)).toBe(false);
  });
});

describe("pinned versions (deploy/windows/versions.json)", () => {
  const versions = JSON.parse(fs.readFileSync("deploy/windows/versions.json", "utf8"));
  it("the app refuses another Node.js or PostgreSQL major", () => {
    expect(nodeVersionProblem(`${PINNED.node}.15.0`)).toBeNull();
    expect(nodeVersionProblem("22.11.0")).toMatch(/Node\.js 22\.11\.0 is not supported: this release needs Node\.js 24\.x/);
    expect(postgresVersionProblem(160015)).toBeNull();
    expect(postgresVersionProblem(170002)).toMatch(/PostgreSQL 17 is not supported: this release needs PostgreSQL 16\.x/);
    expect(postgresVersionProblem(150008)).toMatch(/PostgreSQL 15/);
  });
  it("package.json engines, the installer and the packager follow versions.json", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    expect(pkg.engines.node).toBe(`>=${versions.node.major} <${versions.node.major + 1}`);
    expect(versions.postgresql.wingetId).toBe(`PostgreSQL.PostgreSQL.${versions.postgresql.major}`);
    const common = fs.readFileSync("deploy/windows/common.ps1", "utf8");
    expect(common).toContain('Join-Path $PSScriptRoot "versions.json"');
    expect(common).not.toMatch(/[0-9a-f]{64}/); // no checksum written twice
    expect(fs.readFileSync("scripts/package.mjs", "utf8")).toContain("deploy/windows/versions.json");
  });
});

describe("browser notice: Chrome and Edge", () => {
  const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
  it.each([
    [{ userAgent: chrome }, true],
    [{ userAgent: `${chrome} Edg/142.0.0.0` }, true],
    [{ userAgent: chrome, brands: [{ brand: "Google Chrome", version: "142" }, { brand: "Chromium", version: "142" }] }, true],
    [{ userAgent: chrome, brands: [{ brand: "Microsoft Edge", version: "141" }] }, true],
    [{ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0" }, false],
    [{ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" }, false],
    [{ userAgent: chrome.replace("142.0.0.0", "109.0.0.0") }, false],
  ])("%o → %s", (info, expected) => {
    expect(isSupportedBrowser(info)).toBe(expected);
  });
});
