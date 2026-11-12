// npm run package [-- --version 0.2.0]  →  release/hirefolios-<version>/ (+ .zip) for the Windows office PC.
// Contents: app/ (Next.js standalone server, static files, migrations, bundled node.exe, VERSION.txt, release.env),
// scripts/ (deploy/windows), tools/ (WinSW + Caddy, versions and checksums pinned in deploy/windows/versions.json), docs/.
// The seed runs inside the server at first start (SEED_ON_START=1, set by install.ps1).
// Never included: source, tests, .env files. The build uses its own dist folder, so a running `next dev` is untouched.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const vi = process.argv.indexOf("--version");
const version = vi > 0 ? process.argv[vi + 1] : pkg.version;
if (!/^\d+\.\d+\.\d+([-+][\w.-]+)?$/.test(version ?? "")) throw new Error(`bad version "${version}"`);
const DIST = ".next-release";
const out = path.join(root, "release", `hirefolios-${version}`);
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const step = (s) => console.log(`\n== ${s}`);

// 1. Build (its own dist folder; next build adds that folder's types to tsconfig.json, so put the file back).
step(`building ${version}`);
const tsconfig = fs.readFileSync("tsconfig.json", "utf8");
fs.rmSync(DIST, { recursive: true, force: true });
const build = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
  stdio: "inherit",
  env: { ...process.env, NEXT_DIST_DIR: DIST, NEXT_TELEMETRY_DISABLED: "1" },
});
fs.writeFileSync("tsconfig.json", tsconfig);
if (build.status !== 0) process.exit(build.status ?? 1);

// 2. Tools, pinned in deploy/windows/versions.json (the one place for versions and checksums), cached in .cache/tools.
step("tools");
const versions = JSON.parse(fs.readFileSync("deploy/windows/versions.json", "utf8"));
const tools = ["winsw", "caddy"].map((k) => ({ file: versions[k].file, url: versions[k].url, sha: versions[k].sha256 }));
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor !== versions.node.major) {
  throw new Error(`Build with Node.js ${versions.node.major} (versions.json): this is ${process.version}, and its node.exe is what ships.`);
}
fs.mkdirSync(".cache/tools", { recursive: true });
for (const t of tools) {
  const cached = path.join(".cache/tools", t.file);
  if (!fs.existsSync(cached) || sha256(cached) !== t.sha) {
    console.log(`downloading ${t.url}`);
    const res = await fetch(t.url);
    if (!res.ok) throw new Error(`${t.url}: HTTP ${res.status}`);
    fs.writeFileSync(cached, Buffer.from(await res.arrayBuffer()));
  }
  if (sha256(cached) !== t.sha) throw new Error(`${t.file}: checksum does not match versions.json`);
  console.log(`ok  ${t.file} sha256 ${t.sha.slice(0, 16)}…`);
}

// 3. Assemble.
step(`assembling ${path.relative(root, out)}`);
fs.rmSync(out, { recursive: true, force: true });
fs.rmSync(`${out}.zip`, { force: true });
const app = path.join(out, "app");
fs.cpSync(path.join(DIST, "standalone"), app, { recursive: true });
// next build copies this PC's .env files into standalone/: never ship them (the office PC gets its own).
for (const f of fs.readdirSync(app)) if (f.startsWith(".env")) fs.rmSync(path.join(app, f));
fs.cpSync(path.join(DIST, "static"), path.join(app, DIST, "static"), { recursive: true });
if (fs.existsSync("public")) fs.cpSync("public", path.join(app, "public"), { recursive: true });
fs.cpSync("drizzle", path.join(app, "drizzle"), { recursive: true });
fs.mkdirSync(path.join(app, "node"));
fs.copyFileSync(process.execPath, path.join(app, "node", "node.exe")); // the Node.js the app was built and tested with
fs.writeFileSync(path.join(app, "VERSION.txt"), `${version}\n`);
fs.writeFileSync(path.join(app, "release.env"), `# Read by the service before C:\\hirefolios\\.env (see hirefolios-service.xml)\nAPP_VERSION=${version}\n`);
fs.cpSync("deploy/windows", path.join(out, "scripts"), { recursive: true });
fs.mkdirSync(path.join(out, "tools"));
for (const t of tools) fs.copyFileSync(path.join(".cache/tools", t.file), path.join(out, "tools", t.file));
fs.mkdirSync(path.join(out, "docs"));
for (const d of ["INSTALL.md", "FIRST-DRIVE-CHECKLIST.md"]) fs.copyFileSync(path.join("docs", d), path.join(out, "docs", d));
const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim();
fs.writeFileSync(
  path.join(out, "README.txt"),
  [
    `Hirefolios ${version} (commit ${commit || "unknown"}, built ${new Date().toISOString()}, Node.js ${process.version})`,
    "",
    "New install: right-click PowerShell > Run as administrator, then:",
    `  cd <this folder>`,
    "  powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\install.ps1",
    "Update an installed PC:",
    "  powershell -NoProfile -ExecutionPolicy Bypass -File C:\\hirefolios\\scripts\\update.ps1 -From <this folder>",
    "Full guide: docs\\INSTALL.md",
    "",
  ].join("\r\n"),
);

// 4. Checks: no source, no test or env files, none of this PC's secrets anywhere.
step("checking");
const problems = [];
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const files = walk(out);
for (const f of files) {
  const rel = path.relative(out, f).replaceAll("\\", "/");
  if (/(^|\/)\.env(\.|$)/.test(path.basename(f)) || path.basename(f).startsWith(".env")) problems.push(`env file: ${rel}`);
  if (/^app\/(src|e2e|scripts|deploy|data|\.git|\.claude)\//.test(rel)) problems.push(`source / dev file: ${rel}`);
  if (/\.(spec|test)\.[cm]?[jt]sx?$/.test(rel) && !rel.includes("/node_modules/")) problems.push(`test file: ${rel}`);
}
let secrets = [];
try {
  const env = Object.fromEntries(
    fs.readFileSync(".env", "utf8").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
  );
  const dbPass = env.DATABASE_URL ? decodeURIComponent(new URL(env.DATABASE_URL).password) : "";
  // every secret-looking value in .env (BETTER_AUTH_SECRET, *_PASSWORD, *_TOKEN, ...) and the database password
  const named = Object.entries(env).filter(([k]) => /SECRET|PASSWORD|TOKEN|KEY/.test(k)).map(([, v]) => v);
  secrets = [...named, dbPass].filter((s) => s && s.length >= 8);
} catch {
  // no .env on this PC: nothing to look for
}
for (const f of files) {
  if (fs.statSync(f).size > 20 * 1024 * 1024 || f.endsWith("node.exe")) continue;
  const text = fs.readFileSync(f, "latin1");
  if (secrets.some((s) => text.includes(s))) problems.push(`a secret from .env is inside ${path.relative(out, f)}`);
}
if (!fs.existsSync(path.join(app, "server.js"))) problems.push("app/server.js missing");
if (problems.length) {
  console.error("package FAILED:\n- " + problems.slice(0, 30).join("\n- "));
  process.exit(1);
}
console.log(`ok  ${files.length} files, no source / env files, no secrets from .env (${secrets.length} checked)`);

// 5. One zip for the USB stick (tar.exe ships with Windows 10 1803+ and writes zip with -a).
step("zip");
// Windows' own tar.exe (bsdtar): a GNU tar from Git earlier in PATH reads "C:" as a remote host.
const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
// Contents at the zip's root: Windows "Extract All" already makes a folder named after the zip, so
// Downloads\hirefolios-<version>\scripts\install.ps1 is where docs/INSTALL.md says it is.
const zip = spawnSync(tar, ["-a", "-c", "-f", `${out}.zip`, "-C", out, ...fs.readdirSync(out)], { stdio: "inherit" });
if (zip.status !== 0) throw new Error("tar (zip) failed");
const mb = (fs.statSync(`${out}.zip`).size / 1024 ** 2).toFixed(0);
console.log(`\nrelease ready: ${path.relative(root, out)}  (${path.relative(root, out)}.zip, ${mb} MB)`);
