// npm run db:check — is DATABASE_URL a usable Hirefolios database? Connects, prints the server version, checks it is
// the pinned PostgreSQL major (deploy/windows/versions.json), that every migration in drizzle/ is applied, and that
// pg_trgm is installed. Exit code 1 on any problem. Never prints the password.
import fs from "node:fs";
import postgres from "postgres";
import { postgresVersionProblem, PINNED } from "@/lib/runtime-check";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("FAIL  DATABASE_URL is not set (.env)");
  process.exit(1);
}
const where = url.replace(/\/\/[^@]*@/, "//");
const sql = postgres(url, { max: 1, connect_timeout: 10, onnotice: () => {} });
let failed = false;
const report = (ok: boolean, text: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${text}`);
  if (!ok) failed = true;
};

async function main() {
try {
  const [{ version, num }] = await sql<{ version: string; num: string }[]>`select version(), current_setting('server_version_num') as num`;
  report(true, `connected to ${where}`);
  console.log(`      ${version}`);
  const problem = postgresVersionProblem(Number(num));
  report(!problem, problem ?? `PostgreSQL ${Math.floor(Number(num) / 10000)} = pinned major ${PINNED.postgresql}`);

  const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string; when: number }[] };
  const [{ exists }] = await sql<{ exists: boolean }[]>`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`;
  const applied = exists ? await sql<{ created_at: string }[]>`select created_at from drizzle.__drizzle_migrations` : [];
  const appliedAt = new Set(applied.map((r) => Number(r.created_at)));
  const missing = journal.entries.filter((e) => !appliedAt.has(e.when)).map((e) => e.tag);
  report(missing.length === 0, missing.length ? `migrations not applied: ${missing.join(", ")} (run npm run db:migrate)` : `all ${journal.entries.length} migrations applied`);

  const [trgm] = await sql<{ extversion: string }[]>`select extversion from pg_extension where extname = 'pg_trgm'`;
  report(Boolean(trgm), trgm ? `pg_trgm ${trgm.extversion} installed` : "pg_trgm is not installed (migration 0000 creates it)");
} catch (e) {
  report(false, `cannot use ${where}: ${(e as Error).message}`);
} finally {
  await sql.end({ timeout: 5 });
}
process.exit(failed ? 1 : 0);
}
void main();
