import fs from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import ExcelJS from "exceljs";
import { strFromU8, unzipSync } from "fflate";
import postgres from "postgres";
import { shoot, signIn } from "./helpers";

// Offer → joined, Excel/CSV exports, reports, retention, rights requests, audit log and the TV session,
// in a throwaway tenant whose rows are created here (real rows, deleted afterwards).
const run = Date.now().toString(36);
const sql = postgres(process.env.DATABASE_URL!);
const UPLOAD = process.env.UPLOAD_DIR!;
const SHOTS = process.env.SHOTS_DIR;
const who: Record<"admin" | "hr" | "mgr" | "tv", { id: string; email: string; password: string }> = {} as never;
const pages: Record<string, Page> = {};
let tenantId = "";
const people: Record<string, { candidateId: string; appId: string; mobile: string; name: string }> = {};
const names = { A: `Anita P3${run}`, B: `Bharat P3${run}`, C: `Charu P3${run}`, D: `Dev P3${run}`, E: `Esha P3${run}` };

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000);

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const [t] = await sql`insert into tenants (name, slug, token_prefix) values ('E2E Phase3 Co', ${`e2e-p3-${run}`}, 'P3') returning id`;
  tenantId = t.id;
  const [loc] = await sql`insert into locations (tenant_id, name) values (${tenantId}, 'P3 office') returning id`;
  const st = await sql`insert into stages (tenant_id, name, position, is_interview) values
    (${tenantId}, 'Registered', 1, false), (${tenantId}, 'HR screen', 2, true), (${tenantId}, 'Offer', 3, false) returning id, name`;
  const stage = Object.fromEntries(st.map((s) => [s.name, s.id]));
  const [job] = await sql`insert into jobs (tenant_id, title) values (${tenantId}, 'P3 Coder') returning id`;
  for (const [key, role] of [["admin", "admin"], ["hr", "hr"], ["mgr", "manager"], ["tv", "display"]] as const) {
    const id = crypto.randomUUID();
    const email = `${key}-${run}@e2e-p3.example.test`;
    const password = `Pw-${crypto.randomUUID().slice(0, 12)}`;
    await sql`insert into users (id, name, email, role, tenant_id) values (${id}, ${"P3 " + key}, ${email}, ${role}, ${tenantId})`;
    await sql`insert into accounts (id, account_id, provider_id, user_id, password) values (${crypto.randomUUID()}, ${id}, 'credential', ${id}, ${await hashPassword(password)})`;
    who[key] = { id, email, password };
  }
  // A selected, B rejected, C waiting, D no-show, E rejected but in the talent pool. Today, IST.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const plan = [
    ["A", "selected", null, 90, false, stage["Offer"]],
    ["B", "rejected", "Typing speed below requirement", 80, false, stage["HR screen"]],
    ["C", "in_progress", null, 30, false, stage["Registered"]],
    ["D", "no_show", null, 70, false, stage["HR screen"]],
    ["E", "rejected", "Typing speed below requirement", 60, true, stage["HR screen"]],
  ] as const;
  for (const [i, [k, outcome, reason, ago, pool, stageId]] of plan.entries()) {
    const mobile = `9${String(Date.now()).slice(-5)}${i}${String(i).repeat(3)}`.slice(0, 10);
    const [c] = await sql`insert into candidates (tenant_id, full_name, mobile, email, date_of_birth, city, search_text)
      values (${tenantId}, ${names[k]}, ${mobile}, ${`${k.toLowerCase()}-${run}@p3.example.test`}, '1997-07-07', 'Mohali', ${names[k]}) returning id`;
    const decided = outcome === "in_progress" ? null : minsAgo(ago - 20);
    const [a] = await sql`insert into applications (tenant_id, candidate_id, job_id, location_id, token, token_date, current_stage_id, outcome, reject_reason, client_request_id, created_at, decided_at, source,
        purge_after, photo_purge_after)
      values (${tenantId}, ${c.id}, ${job.id}, ${loc.id}, ${`A-00${i + 1}`}, ${today}, ${stageId}, ${outcome}, ${reason}, ${crypto.randomUUID()}, ${minsAgo(ago)}, ${decided}, ${i % 2 ? "Naukri" : "Employee referral"},
        ${outcome === "rejected" || outcome === "no_show" ? (pool ? null : new Date(Date.now() + 365 * 864e5)) : null}, ${outcome === "rejected" || outcome === "no_show" ? (pool ? null : new Date(Date.now() + 180 * 864e5)) : null})
      returning id`;
    await sql`insert into consents (tenant_id, candidate_id, application_id, notice_version, language, talent_pool) values (${tenantId}, ${c.id}, ${a.id}, 'test', 'en', ${pool})`;
    if (outcome !== "in_progress") {
      await sql`insert into queue_events (tenant_id, application_id, stage_id, event, created_at, interviewer_id) values
        (${tenantId}, ${a.id}, ${stage["HR screen"]}, 'called', ${minsAgo(ago - 10)}, ${who.mgr.id}),
        (${tenantId}, ${a.id}, ${stage["HR screen"]}, 'completed', ${minsAgo(ago - 20)}, ${who.mgr.id})`;
    }
    // a photo on disk for each (access ZIP + erasure must handle real files)
    const fileId = crypto.randomUUID();
    const key = `${tenantId}/${c.id}/${fileId}.jpg`;
    fs.mkdirSync(path.join(UPLOAD, tenantId, c.id), { recursive: true });
    fs.writeFileSync(path.join(UPLOAD, key), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    await sql`insert into candidate_files (id, tenant_id, candidate_id, application_id, kind, storage_key, mime_type, size_bytes) values (${fileId}, ${tenantId}, ${c.id}, ${a.id}, 'photo', ${key}, 'image/jpeg', 7)`;
    people[k] = { candidateId: c.id, appId: a.id, mobile, name: names[k] };
  }
  for (const [key, viewport] of [["admin", { width: 1440, height: 900 }], ["hr", { width: 1366, height: 768 }], ["tv", { width: 1920, height: 1080 }]] as const) {
    pages[key] = await (await browser.newContext({ viewport, acceptDownloads: true })).newPage();
    await signIn(pages[key], who[key]);
  }
});

test.afterAll(async () => {
  for (const p of Object.values(pages)) await p.context().close();
  const t = [tenantId];
  for (const q of ["scorecards", "queue_events", "candidate_files", "consents", "dsr_requests", "exports"]) await sql`delete from ${sql(q)} where tenant_id in ${sql(t)}`;
  await sql`delete from applications where tenant_id in ${sql(t)}`;
  await sql`delete from panels where tenant_id in ${sql(t)}`;
  await sql`delete from drives where tenant_id in ${sql(t)}`;
  for (const q of ["candidates", "daily_counters", "audit_log", "reject_reasons", "option_items", "privacy_notices", "users", "jobs", "stages", "locations"]) await sql`delete from ${sql(q)} where tenant_id in ${sql(t)}`;
  await sql`delete from tenants where id = ${tenantId}`;
  fs.rmSync(path.join(UPLOAD, tenantId), { recursive: true, force: true });
  await sql.end();
});

async function download(page: Page, click: () => Promise<void>) {
  const [d] = await Promise.all([page.waitForEvent("download"), click()]);
  return { name: d.suggestedFilename(), bytes: fs.readFileSync((await d.path())!) };
}

test("offer → mark joined on the profile", async () => {
  const p = pages.hr;
  await p.goto(`/dashboard/candidates/${people.A.candidateId}`);
  const box = p.getByRole("region", { name: "Offer and joining" });
  await box.getByLabel("Offer status").selectOption("accepted");
  await box.getByLabel("Offered CTC (LPA)").fill("3.6");
  await box.getByLabel("Joining date").fill(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()));
  await box.getByRole("button", { name: "Save offer" }).click();
  await expect(box.getByText("Offer saved.")).toBeVisible();
  p.once("dialog", (d) => d.accept());
  await box.getByRole("button", { name: "Mark joined" }).click();
  await expect(p.getByText(/Joined \d\d \w{3} \d{4}/)).toBeVisible();
  await expect(p.getByText("talent pool: no purge date")).toHaveCount(0);
  await expect(p.getByRole("region", { name: "Offer and joining" })).toHaveCount(0); // no more offer actions once joined
  await shoot(p, "profile-offer-joined", { width: 1366, height: 768 });
  const [a] = await sql`select outcome, offer_status, offered_ctc, joined_on is not null as joined, decided_at is not null as decided, purge_after from applications where id = ${people.A.appId}`;
  expect(a).toEqual({ outcome: "joined", offer_status: "accepted", offered_ctc: 360000, joined: true, decided: true, purge_after: null });
});

test("filtered Excel export has exactly the listed rows; joined CSV has the employee", async () => {
  const p = pages.hr;
  await p.goto("/dashboard?status=rejected");
  await expect(p.getByRole("link", { name: names.B })).toBeVisible();
  const x = await download(p, () => p.getByRole("link", { name: "Export to Excel" }).click());
  expect(x.name).toMatch(/^candidates-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(x.bytes as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Candidates")!;
  const header = (ws.getRow(1).values as unknown[]).slice(1);
  expect(header.slice(0, 3)).toEqual(["Name", "Mobile", "Email"]);
  expect(header).not.toContain("Photo");
  const rows = ws.getSheetValues().slice(2).map((r) => (r as unknown[])[1]).filter(Boolean).sort();
  expect(rows).toEqual([names.B, names.E].sort());
  const csv = await p.request.get("/api/exports/joined?format=csv");
  const text = await csv.text();
  expect(text).toContain(names.A);
  expect(text).toContain("3.6");
  expect(text).not.toContain(names.B);
  const [e] = await sql`select count(*)::int n from exports where tenant_id = ${tenantId}`;
  expect(e.n).toBe(2);
  const audit = await sql`select meta from audit_log where tenant_id = ${tenantId} and action = 'export.download'`;
  expect(audit.map((r) => r.meta.rows).sort()).toEqual([1, 2]);
});

test("reports show the real numbers of this tenant", async () => {
  const p = pages.hr;
  await p.goto("/dashboard/reports");
  const tile = (k: string) => p.getByTestId(`tile-${k}`);
  await expect(tile("Walk-ins")).toHaveText("5");
  await expect(tile("Unique candidates")).toHaveText("5");
  await expect(tile("Selected")).toHaveText("1 (20%)"); // A (now joined)
  await expect(tile("Joined")).toHaveText("1");
  await expect(tile("Rejected")).toHaveText("2");
  await expect(tile("No-show")).toHaveText("1");
  await expect(tile("Average wait")).toHaveText("10 min");
  await expect(p.getByText(/data as of \d\d \w{3} \d{4}/)).toBeVisible();
  await expect(p.getByRole("list", { name: "Top reject reasons" })).toContainText("Typing speed below requirement");
  await expect(p.getByRole("img", { name: "Walk-ins per day" })).toBeVisible();
  await shoot(p, "reports", { width: 1366, height: 768 });
  await p.goto("/dashboard/reports?from=2020-01-01&to=2020-01-31");
  await expect(p.getByText(/No walk-ins between/)).toBeVisible();
});

test("retention change with re-calculation updates purge dates (audited)", async () => {
  const p = pages.admin;
  await p.goto("/dashboard/settings");
  await expect(p.getByTestId("purge-preview")).toContainText("next 7 days");
  await p.getByLabel("Delete photos after (days)").fill("400");
  await p.getByLabel("Delete all other data after (days)").fill("200");
  await p.getByRole("button", { name: "Save periods" }).click();
  await expect(p.getByRole("alert").filter({ hasText: "Photos can't be kept longer" })).toBeVisible();
  await p.getByLabel("Delete photos after (days)").fill("60");
  await p.getByLabel("Re-calculate the deletion dates").check();
  p.once("dialog", (d) => d.accept());
  await p.getByRole("button", { name: "Save periods" }).click();
  await expect(p.getByText("Existing deletion dates were re-calculated.")).toBeVisible();
  await shoot(p, "settings-retention");
  const [b] = await sql`select extract(epoch from (purge_after - decided_at)) / 86400 as d, extract(epoch from (photo_purge_after - decided_at)) / 86400 as pd from applications where id = ${people.B.appId}`;
  expect([Math.round(b.d), Math.round(b.pd)]).toEqual([200, 60]);
  const [e] = await sql`select purge_after from applications where id = ${people.E.appId}`;
  expect(e.purge_after).toBeNull(); // talent pool stays
  const [a] = await sql`select purge_after from applications where id = ${people.A.appId}`;
  expect(a.purge_after).toBeNull(); // joined stays
  const [log] = await sql`select meta from audit_log where tenant_id = ${tenantId} and action = 'tenant.retention'`;
  expect(log.meta).toMatchObject({ photoRetentionDays: 60, dataRetentionDays: 200 });
});

test("rights requests: access ZIP and erase now", async () => {
  const p = pages.hr;
  await p.goto("/dashboard/privacy");
  const form = p.getByRole("form", { name: "Log a request" });
  await form.getByLabel("Kind").selectOption("access");
  await form.getByLabel("Who asked").fill(names.B);
  await form.getByLabel("Candidate's mobile").fill(people.B.mobile);
  await form.getByRole("button", { name: "Log request" }).click();
  await expect(p.getByText("Request logged.")).toBeVisible();
  const zip = await download(p, () => p.getByRole("link", { name: "Download their data (ZIP)" }).click());
  const files = unzipSync(new Uint8Array(zip.bytes));
  const data = JSON.parse(strFromU8(files["data.json"]));
  expect(data.profile.fullName).toBe(names.B);
  expect(data.visits[0].rejectReason).toBe("Typing speed below requirement");
  expect(Object.keys(files).some((f) => f.startsWith("files/photo-"))).toBe(true);
  expect(JSON.stringify(data)).not.toContain(tenantId); // no internal tenant ids

  await form.getByLabel("Kind").selectOption("erasure");
  await form.getByLabel("Who asked").fill(names.D);
  await form.getByLabel("Candidate's mobile").fill(people.D.mobile);
  await form.getByRole("button", { name: "Log request" }).click();
  const item = p.getByRole("listitem").filter({ hasText: "Erasure" });
  await expect(item).toContainText("due");
  p.once("dialog", (d) => d.accept("ERASE"));
  await item.getByRole("button", { name: "Erase now" }).click();
  await expect(p.getByText("Erased. The request is marked completed.")).toBeVisible();
  await expect(item.getByLabel("Status")).toHaveValue("completed"); // the form follows the refreshed status
  await shoot(p, "privacy", { width: 1366, height: 768 });
  const [left] = await sql`select (select count(*)::int from candidates where id = ${people.D.candidateId}) as c,
    (select count(*)::int from applications where candidate_id = ${people.D.candidateId}) as a,
    (select count(*)::int from candidate_files where candidate_id = ${people.D.candidateId}) as f`;
  expect(left).toEqual({ c: 0, a: 0, f: 0 });
  expect(fs.existsSync(path.join(UPLOAD, tenantId, people.D.candidateId))).toBe(false);
  const [r] = await sql`select status, candidate_id from dsr_requests where tenant_id = ${tenantId} and kind = 'erasure'`;
  expect(r).toEqual({ status: "completed", candidate_id: null });
  const [log] = await sql`select meta from audit_log where tenant_id = ${tenantId} and action = 'candidate.erase'`;
  expect(JSON.stringify(log.meta)).not.toContain(names.D);
});

test("audit viewer filters and exports CSV (admin only)", async () => {
  const p = pages.admin;
  await p.goto("/dashboard/audit?action=candidate.erase");
  await expect(p.getByRole("row")).toHaveCount(2); // header + 1
  await shoot(p, "audit");
  const csv = await download(p, () => p.getByRole("link", { name: "Export CSV" }).click());
  const text = csv.bytes.toString("utf8");
  expect(text).toContain("candidate.erase");
  expect(text.split("\r\n").filter(Boolean)).toHaveLength(2);
  const hr = await pages.hr.request.get("/api/audit/export");
  expect(hr.status()).toBe(403);
  await pages.hr.goto("/dashboard/audit");
  await expect(pages.hr).toHaveURL(/\/intake$/);
});

test("lobby TV: 30-day session, /tv only, admin can sign it out", async () => {
  const tv = pages.tv;
  await tv.goto("/tv");
  await expect(tv.getByTestId("tv-waiting")).toBeVisible();
  if (SHOTS) await tv.screenshot({ path: path.join(SHOTS, "tv-1920x1080.png") });
  const [s] = await sql`select extract(epoch from (expires_at - created_at)) / 86400 as days from sessions where user_id = ${who.tv.id}`;
  expect(Math.round(s.days)).toBe(30);
  const [h] = await sql`select extract(epoch from (expires_at - created_at)) / 3600 as hours from sessions where user_id = ${who.hr.id} order by created_at desc limit 1`;
  expect(Math.round(h.hours)).toBe(12);
  for (const url of ["/dashboard", "/intake", "/dashboard/reports", "/dashboard/privacy"]) {
    await tv.goto(url);
    await expect(tv).toHaveURL(/\/tv$/);
  }
  expect((await tv.request.get(`/api/candidates/lookup?mobile=${people.B.mobile}`)).status()).toBe(403);
  expect((await tv.request.get("/api/exports/joined")).status()).toBe(403);
  const admin = pages.admin;
  await admin.goto("/dashboard/users");
  admin.once("dialog", (d) => d.accept());
  await admin.getByRole("row").filter({ hasText: who.tv.email }).getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(admin.getByRole("status")).toContainText("signed out everywhere");
  await tv.goto("/tv");
  await expect(tv).toHaveURL(/\/login$/);
});
