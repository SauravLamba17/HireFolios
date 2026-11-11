// npm run dev:check — starts `next dev` (its own dist folder and port, so a running preview is untouched),
// signs in as the seed admin (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD), loads the key pages and fails on any
// 5xx or dev build error. Catches dev-only breaks (e.g. node:* modules pulled into the edge compile)
// that a production build does not show. Needs the database up. DEV_CHECK_PORT (default 3199).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";

try { process.loadEnvFile(); } catch { /* no .env: use the real environment */ }
const port = process.env.DEV_CHECK_PORT || "3199";
const base = `http://127.0.0.1:${port}`;
const PAGES = [
  "/login", "/intake", "/dashboard", "/dashboard/drive", "/dashboard/reports", "/dashboard/privacy",
  "/dashboard/audit", "/dashboard/settings", "/dashboard/users", "/interview", "/tv", "/account/password", "/api/health",
];
const BAD = /Module build failed|UnhandledSchemeError|Failed to compile|⨯|Error: /;

// next dev adds its dist folder's types to tsconfig.json: put the file back afterwards.
const tsconfig = fs.readFileSync("tsconfig.json", "utf8");
let log = "";
const dev = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", port, "-H", "127.0.0.1"], {
  env: { ...process.env, NEXT_DIST_DIR: ".next-devcheck" },
});
dev.stdout.on("data", (d) => (log += d));
dev.stderr.on("data", (d) => (log += d));

const problems = [];
try {
  for (let i = 0; !log.includes("Ready in"); i++) {
    if (i > 120 || dev.exitCode !== null) throw new Error("next dev did not start:\n" + log);
    await new Promise((r) => setTimeout(r, 500));
  }
  let cookie = "";
  if (process.env.SEED_ADMIN_EMAIL && process.env.SEED_ADMIN_PASSWORD) {
    const res = await fetch(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }),
    });
    if (!res.ok) problems.push(`sign-in as the seed admin: ${res.status}`);
    cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  } else console.log("SEED_ADMIN_* not set: pages load signed out (redirects only)");
  for (const p of PAGES) {
    const res = await fetch(base + p, { headers: { cookie }, redirect: "manual" });
    const body = await res.text();
    const ok = res.status < 500 && !body.includes("UnhandledSchemeError") && !body.includes("Module build failed");
    console.log(`${ok ? "ok  " : "FAIL"} ${res.status} ${p}`);
    if (!ok) problems.push(`${p}: ${res.status}`);
  }
  const bad = log.split("\n").filter((l) => BAD.test(l));
  if (bad.length) problems.push("dev server output:\n  " + bad.join("\n  "));
  if (process.env.PURGE_JOB !== "off") {
    const n = log.split("deletion job scheduled").length - 1;
    if (n !== 1) problems.push(`deletion job scheduled ${n} times (expected once)`);
  }
} catch (e) {
  problems.push(String(e));
} finally {
  // next dev runs the server in a child process: end the whole tree (Windows leaves children behind otherwise).
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(dev.pid), "/T", "/F"]);
  else dev.kill();
  fs.writeFileSync("tsconfig.json", tsconfig);
}
if (problems.length) {
  console.error("\nnext dev check FAILED:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log(`\nnext dev check passed: ${PAGES.length} pages, no build errors`);
process.exit(0);
