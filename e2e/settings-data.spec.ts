import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import postgres from "postgres";
import { signIn } from "./helpers";

// Phase 3.5: lists, privacy notice and company profile live in the database and are edited in Settings, the way
// the company's admin would. Everything this test changes is put back afterwards (and its candidates removed).
const admin = { email: process.env.SEED_ADMIN_EMAIL!, password: process.env.SEED_ADMIN_PASSWORD! };
const run = Date.now().toString(36);
const sql = postgres(process.env.DATABASE_URL!);
const DESK = { width: 1366, height: 768 };
const mobiles = [1, 2, 3].map((i) => `6${String(Date.now()).slice(-7)}${i}${i}`.slice(0, 10));
let page: Page;
let tenantId: string;
let before: { company: Record<string, unknown>; activeNoticeId: string };
const otherTenant = { id: "", slug: `e2e-leak-${run}` };
const SHOTS = process.env.SHOTS_DIR;

test.describe.configure({ mode: "serial" });

async function shots(name: string) {
  if (!SHOTS) return;
  for (const v of [{ n: "1440", width: 1440, height: 900 }, { n: "1366x768", width: 1366, height: 768 }, { n: "1024", width: 1024, height: 768 }]) {
    await page.setViewportSize({ width: v.width, height: v.height });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SHOTS, `${name}-${v.n}.png`), fullPage: true });
  }
  await page.setViewportSize(DESK);
}

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ viewport: DESK })).newPage();
  [{ tenantId }] = await sql`select tenant_id as "tenantId" from users where email = ${admin.email}`;
  const [c] = await sql`select name, short_name, token_prefix, office_address, logo_key, logo_type, profile_sample from tenants where id = ${tenantId}`;
  const [n] = await sql`select id from privacy_notices where tenant_id = ${tenantId} and status = 'active'`;
  before = { company: c, activeNoticeId: n?.id };
});

test.afterAll(async () => {
  // candidates of this test
  const cands = await sql<{ id: string }[]>`select id from candidates where tenant_id = ${tenantId} and mobile in ${sql(mobiles)}`;
  const up = process.env.UPLOAD_DIR;
  for (const c of cands) {
    await sql`delete from candidate_files where candidate_id = ${c.id}`;
    await sql`delete from consents where candidate_id = ${c.id}`;
    await sql`delete from applications where candidate_id = ${c.id}`;
    await sql`delete from candidates where id = ${c.id}`;
    if (up && path.isAbsolute(up)) fs.rmSync(path.join(up, tenantId, c.id), { recursive: true, force: true });
  }
  // lists: names back, items back in use, added items removed
  await sql`update option_items set label = 'CPC' where tenant_id = ${tenantId} and list = 'certification' and label = ${`CPC (AAPC) ${run}`}`;
  await sql`update option_items set active = true where tenant_id = ${tenantId} and list = 'source' and label = 'Newspaper'`;
  await sql`update option_items set active = true where tenant_id = ${tenantId} and list = 'certification' and label = 'COC'`;
  await sql`delete from option_items where tenant_id = ${tenantId} and label like ${`%${run}%`}`;
  // notice: the version published here goes, the earlier one is in use again
  if (before.activeNoticeId) {
    await sql`delete from privacy_notices where tenant_id = ${tenantId} and id <> ${before.activeNoticeId} and (status = 'draft' or published_at > now() - interval '1 hour')`;
    await sql`update privacy_notices set status = 'active' where id = ${before.activeNoticeId}`;
  }
  // company profile and logo
  const [now] = await sql`select logo_key from tenants where id = ${tenantId}`;
  if (now?.logo_key && now.logo_key !== before.company.logo_key && up) fs.rmSync(path.join(up, now.logo_key), { force: true });
  const c = before.company as { name: string; short_name: string | null; token_prefix: string; office_address: string | null; logo_key: string | null; logo_type: string | null; profile_sample: boolean };
  await sql`update tenants set name = ${c.name}, short_name = ${c.short_name}, token_prefix = ${c.token_prefix}, office_address = ${c.office_address}, logo_key = ${c.logo_key}, logo_type = ${c.logo_type}, profile_sample = ${c.profile_sample} where id = ${tenantId}`;
  if (otherTenant.id) {
    await sql`delete from option_items where tenant_id = ${otherTenant.id}`;
    await sql`delete from tenants where id = ${otherTenant.id}`;
  }
  await sql`delete from audit_log where tenant_id = ${tenantId} and created_at > now() - interval '1 hour' and action like any (array['option_item.%', 'notice.%', 'company.%'])`;
  await sql.end();
});

/** Registers a candidate through the intake API (as the wizard does). */
async function register(mobile: string, details: Record<string, unknown>) {
  const [job] = await sql`select id from jobs where tenant_id = ${tenantId} and status = 'open' order by title limit 1`;
  const [n] = await sql`select version from privacy_notices where tenant_id = ${tenantId} and status = 'active'`;
  const jpeg = await page.screenshot({ type: "jpeg" });
  const res = await page.request.post("/api/intake", {
    multipart: {
      data: JSON.stringify({
        clientRequestId: crypto.randomUUID(),
        mobile,
        details: {
          jobId: job.id, fullName: `E2E Lists ${run} ${mobile.slice(-2)}`, dateOfBirth: "1996-03-04", email: "", city: "Mohali", education: "BA",
          experienceYears: 1, experienceMonths: 0, currentCtcLpa: null, expectedCtcLpa: 3, noticeDays: 30, languages: ["Hindi"], source: "Other",
          hrNotes: "", certifications: [], codingSpecialties: [], ehrSoftware: [], nightShiftOk: true, voiceProcess: true, typingWpm: null, skills: "",
          ...details,
        },
        consent: { agreed: true, language: "en", noticeVersion: n.version, talentPool: false, whatsapp: false },
      }),
      photo: { name: "p.jpg", mimeType: "image/jpeg", buffer: jpeg },
    },
  });
  return { status: res.status(), body: await res.json() };
}

test("Lists: rename a certification, add an EHR, retire a source → intake and search filters follow", async () => {
  await signIn(page, admin);
  // an older candidate who has COC and came via Newspaper
  const old = await register(mobiles[0], { certifications: ["COC"], source: "Newspaper" });
  expect(old.status).toBe(201);

  await page.goto("/dashboard/settings/lists");
  await expect(page.getByRole("heading", { name: "Lists", exact: true })).toBeVisible();
  await shots("settings-lists");
  const certs = page.getByRole("region", { name: "Certifications" });
  const cpcId = await certs.locator('input[value="CPC"]').getAttribute("id"); // the row by its id: the value changes as we type
  const cpcRow = page.locator(`li:has(#${cpcId})`);
  await cpcRow.getByRole("textbox", { name: "Name" }).fill(`CPC (AAPC) ${run}`);
  await cpcRow.getByRole("button", { name: "Save" }).click();
  await expect(cpcRow.getByRole("status")).toContainText("Saved.");

  const cocRow = certs.locator("li").filter({ has: page.locator('[value="COC"]') });
  await cocRow.getByRole("checkbox", { name: "In use" }).uncheck();
  await cocRow.getByRole("button", { name: "Save" }).click();
  await expect(cocRow.getByText("Retired")).toBeVisible();

  const ehr = page.getByRole("region", { name: "EHR / PM software" });
  await ehr.getByLabel("New item").fill(`E2E EHR ${run}`);
  await ehr.getByRole("button", { name: "Add" }).click();
  await expect(ehr.getByRole("status")).toContainText(`Added E2E EHR ${run}`);

  const sources = page.getByRole("region", { name: "Sources" });
  const news = sources.locator("li").filter({ has: page.locator('[value="Newspaper"]') });
  await news.getByRole("checkbox", { name: "In use" }).uncheck();
  await news.getByRole("button", { name: "Save" }).click();
  await expect(news.getByText("Retired")).toBeVisible();
  // move up / down renumbers the list
  const before2 = (await sql`select label from option_items where tenant_id = ${tenantId} and list = 'language' order by position`).map((r) => r.label);
  await page.getByRole("button", { name: `Move ${before2[1]} up` }).click();
  await expect.poll(async () => (await sql`select label from option_items where tenant_id = ${tenantId} and list = 'language' order by position`).map((r) => r.label).slice(0, 2)).toEqual([before2[1], before2[0]]);
  await page.getByRole("button", { name: `Move ${before2[0]} up` }).click();
  await expect.poll(async () => (await sql`select label from option_items where tenant_id = ${tenantId} and list = 'language' order by position`).map((r) => r.label).slice(0, 2)).toEqual(before2.slice(0, 2));
  const audits = await sql`select action, meta from audit_log where tenant_id = ${tenantId} and action like 'option_item.%' and created_at > now() - interval '5 minutes'`;
  expect(audits.length).toBeGreaterThanOrEqual(6);
  expect(JSON.stringify(audits)).not.toContain("Newspaper"); // ids and codes only

  // intake form: new names, no retired items
  await page.goto("/intake");
  await page.getByRole("textbox", { name: "Mobile number" }).fill(mobiles[1]);
  await page.getByRole("button", { name: "Find" }).click();
  await page.getByRole("button", { name: "Next: details →" }).click();
  const certGroup = page.getByRole("group", { name: "Certifications" });
  await expect(certGroup.getByRole("button", { name: `CPC (AAPC) ${run}` })).toBeVisible();
  await expect(certGroup.getByRole("button", { name: "COC", exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "EHR / PM software" }).getByRole("button", { name: `E2E EHR ${run}` })).toBeVisible();
  await expect(page.getByLabel("How did they hear about us?").locator("option", { hasText: "Newspaper" })).toHaveCount(0);
  await shots("intake-details-lists");

  // the server refuses retired items too, and takes the renamed / new ones
  expect((await register(mobiles[1], { certifications: ["COC"] })).body.error).toMatch(/certification/);
  expect((await register(mobiles[1], { source: "Newspaper" })).body.error).toMatch(/heard about/);
  const ok = await register(mobiles[1], { certifications: [`CPC (AAPC) ${run}`], ehrSoftware: [`E2E EHR ${run}`] });
  expect(ok.status).toBe(201);

  // search filters: the renamed one finds the new candidate; the retired one is still offered and finds the old
  await page.goto(`/dashboard?cert=${encodeURIComponent(`CPC (AAPC) ${run}`)}`);
  await expect(page.getByRole("link", { name: `E2E Lists ${run} ${mobiles[1].slice(-2)}` })).toBeVisible();
  await expect(page.getByLabel("Certification").locator("option", { hasText: "COC (no longer offered)" })).toHaveCount(1);
  await page.goto("/dashboard?cert=COC");
  await expect(page.getByRole("link", { name: `E2E Lists ${run} ${mobiles[0].slice(-2)}` })).toBeVisible();

  // the old candidate keeps the retired items on the profile
  await page.getByRole("link", { name: `E2E Lists ${run} ${mobiles[0].slice(-2)}` }).click();
  await expect(page.getByText("COC", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Newspaper").first()).toBeVisible();

  // and a returning visit does not prefill the retired certification
  await page.goto("/intake");
  await page.getByRole("textbox", { name: "Mobile number" }).fill(mobiles[0]);
  await page.getByRole("button", { name: "Find" }).click();
  await page.getByRole("button", { name: /Continue with this candidate/ }).click();
  await expect(page.getByLabel("Full name")).toHaveValue(`E2E Lists ${run} ${mobiles[0].slice(-2)}`);
  await expect(page.getByRole("group", { name: "Certifications" }).getByRole("button", { pressed: true })).toHaveCount(0);
});

test("Privacy notice: fix the Hindi text and publish; old consents keep their version", async () => {
  const [oldConsent] = await sql`select k.notice_version from consents k join candidates c on c.id = k.candidate_id where c.mobile = ${mobiles[0]}`;
  await page.goto("/dashboard/settings/notice");
  await page.getByRole("button", { name: "Start a new version" }).click();
  await expect(page.getByRole("heading", { name: "Draft (not shown to candidates yet)" })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Ritu Sharma");
  await page.getByLabel("Email", { exact: true }).fill(`dpo-${run}@e2e.example.test`);
  await page.getByRole("button", { name: "Edit हिन्दी" }).click();
  const p1 = page.getByLabel("Paragraph 1");
  await p1.fill(`${await p1.inputValue()} (संशोधित ${run})`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Draft saved." })).toBeVisible();
  await shots("settings-notice-draft");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Publish as new version" }).click();
  // the draft is gone once published, so the page shows the new version in use
  await expect.poll(async () => (await sql`select status from privacy_notices where id = ${before.activeNoticeId}`)[0]?.status, { timeout: 10_000 }).toBe("retired");
  await expect(page.getByRole("button", { name: "Start a new version" })).toBeVisible();
  await expect(page.getByTestId("notice-in-use")).toContainText(/In use at intake: v\d+-/);
  const [active] = await sql`select version, contact_name, texts from privacy_notices where tenant_id = ${tenantId} and status = 'active'`;
  expect(active.version).toMatch(/^v\d+-\d{4}-\d{2}-\d{2}$/);
  expect(active.contact_name).toBe("Ritu Sharma");
  expect(JSON.stringify(active.texts)).toContain(`संशोधित ${run}`);
  const retired = await sql`select status from privacy_notices where id = ${before.activeNoticeId}`;
  expect(retired[0].status).toBe("retired");
  // the earlier consent still carries the version it was given
  const [stillOld] = await sql`select k.notice_version from consents k join candidates c on c.id = k.candidate_id where c.mobile = ${mobiles[0]}`;
  expect(stillOld.notice_version).toBe(oldConsent.notice_version);
  expect(stillOld.notice_version).not.toBe(active.version);
  await expect(page.getByText("Retired (read-only)").first()).toBeVisible();

  // intake shows the new version, with the contact person, in Hindi
  await page.goto("/intake");
  await page.getByRole("textbox", { name: "Mobile number" }).fill(mobiles[2]);
  await page.getByRole("button", { name: "Find" }).click();
  await page.getByRole("button", { name: "Next: details →" }).click();
  await page.getByRole("radio").first().click();
  await page.getByLabel("Full name").fill(`E2E Lists ${run} ${mobiles[2].slice(-2)}`);
  await page.getByLabel("Date of birth").fill("1995-02-02");
  await page.getByLabel("City").fill("Mohali");
  await page.getByLabel("Education").selectOption("BA");
  await page.getByLabel("Experience years").selectOption("0");
  await page.getByLabel("Experience months").selectOption("0");
  await page.getByLabel("Notice period").selectOption({ label: "Immediate" });
  await page.getByLabel("How did they hear about us?").selectOption("Other");
  await page.getByRole("radiogroup", { name: "OK with night / US shift?" }).getByRole("radio", { name: "Yes" }).click();
  await page.getByRole("radiogroup", { name: "OK with voice process (calls)?" }).getByRole("radio", { name: "Yes" }).click();
  await page.getByRole("button", { name: /Next: consent/ }).click();
  await page.getByRole("button", { name: "The candidate can see the screen" }).click();
  await expect(page.getByText(`Notice ${active.version}`)).toBeVisible();
  await page.getByRole("button", { name: "हिन्दी" }).click();
  await expect(page.getByText(`संशोधित ${run}`)).toBeVisible();
  await expect(page.getByText(/Ritu Sharma/)).toBeVisible();
  await page.getByRole("button", { name: "मैं सहमत नहीं हूँ" }).or(page.getByRole("button", { name: "I do not agree" })).first().click();
  await page.getByRole("button", { name: "Cancel this candidate" }).click();
});

test("Company: name, short name, token prefix and logo show in header, TV, tokens and exports", async () => {
  await page.goto("/dashboard/settings/company");
  await page.getByLabel("Company name").fill(`E2E Company ${run}`);
  await page.getByLabel("Short name (optional)").fill(`E2E${run.slice(-3)}`);
  await page.getByLabel("Token prefix").fill("t");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  // a 1x1 PNG
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.getByTestId("logo-upload").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("status").filter({ hasText: "Logo saved." })).toBeVisible();
  await page.getByTestId("logo-upload").setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg onload=alert(1)>") });
  await expect(page.getByRole("alert").filter({ hasText: "PNG, JPEG or WebP" })).toBeVisible();
  await shots("settings-company");

  // header
  await page.reload();
  const header = page.getByTestId("header-company");
  await expect(header).toContainText(`E2E${run.slice(-3)}`);
  const logoSrc = await page.locator('header a[href="/"] img').getAttribute("src");
  expect((await page.request.get(logoSrc!)).headers()["content-type"]).toBe("image/png");
  // signed out: no logo
  expect((await (await page.context().browser()!.newContext()).request.get(new URL(logoSrc!, page.url()).href)).status()).toBe(401);

  // token prefix
  const r = await register(mobiles[2], {});
  expect(r.status).toBe(201);
  expect(r.body.token).toMatch(/^T-\d{3}$/);

  // lobby TV
  await page.goto("/tv");
  await expect(page.getByTestId("tv-company")).toContainText(`E2E Company ${run}`);
  await expect(page.getByTestId("tv-company").locator("img")).toBeVisible();

  // Excel export: workbook company, a Company sheet with the logo
  const res = await page.request.get("/api/exports/candidates");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await res.body()) as unknown as ArrayBuffer);
  expect(wb.company).toBe(`E2E Company ${run}`);
  const ws = wb.getWorksheet("Company")!;
  expect(ws.getCell("A2").value).toBe(`E2E Company ${run}`);
  expect(ws.getImages().length).toBe(1);
  expect(wb.getWorksheet("Candidates")!.headerFooter.oddHeader).toContain(`E2E Company ${run}`);

  const audits = await sql`select action, meta from audit_log where tenant_id = ${tenantId} and action like 'company.%' and created_at > now() - interval '5 minutes'`;
  expect(audits.map((a) => a.action).sort()).toEqual(["company.logo", "company.update"]);
  expect(JSON.stringify(audits)).not.toContain(`E2E Company ${run}`);
});

test("another tenant's lists never show and cannot be edited", async () => {
  [{ id: otherTenant.id }] = await sql`insert into tenants (name, slug, token_prefix) values ('E2E Other', ${otherTenant.slug}, 'O') returning id`;
  const [leak] = await sql`insert into option_items (tenant_id, list, label, position) values (${otherTenant.id}, 'ehr_software', ${`LEAK ${run}`}, 1) returning id`;
  await page.goto("/dashboard/settings/lists");
  await expect(page.getByText(`LEAK ${run}`)).toHaveCount(0);
  const res = await page.request.post("/api/settings/lists", { data: { action: "update", list: "ehr_software", itemId: leak.id, label: "hijacked", active: false }, headers: { origin: new URL(page.url()).origin } });
  expect(res.status()).toBe(404);
  const [still] = await sql`select label, active from option_items where id = ${leak.id}`;
  expect(still).toEqual({ label: `LEAK ${run}`, active: true });
  expect((await register(mobiles[2], { ehrSoftware: [`LEAK ${run}`] })).body.error).toMatch(/software/);
});
