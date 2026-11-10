import fs from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";
import { shoot, signIn } from "./helpers";

// Runs against the seeded tenant with a fake camera (see playwright.config.ts).
// Everything it creates (staff, candidates, files, a job) is deleted afterwards.
const TEST_DOMAIN = "e2e.example.test";
const admin = { email: process.env.SEED_ADMIN_EMAIL!, password: process.env.SEED_ADMIN_PASSWORD! };
const run = Date.now().toString(36);
const hr = { name: "E2E Intake HR", email: `intake-hr-${run}@${TEST_DOMAIN}`, password: `Temp-${crypto.randomUUID().slice(0, 10)}` };
const hrFinal = `Own-${crypto.randomUUID().slice(0, 12)}`;
const rnd9 = () => String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
const mobile = `7${rnd9()}`;
const lanMobile = `8${rnd9()}`;
const candidateName = `E2E Candidate ${run}`;
const jobTitle = `E2E Test Job ${run}`;
const TABLET = { width: 800, height: 1280 };

const sql = postgres(process.env.DATABASE_URL!);
let adminPage: Page;
let hrPage: Page;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  adminPage = await (await browser.newContext()).newPage();
  hrPage = await (await browser.newContext({ viewport: TABLET })).newPage();
});

// The default failure snapshot shows the wrong tab here, so attach both.
test.afterEach(async ({}, info) => {
  if (info.status === info.expectedStatus) return;
  for (const [name, p] of [["tablet", hrPage], ["admin", adminPage]] as const) {
    const shot = await p.screenshot({ fullPage: true }).catch(() => null);
    if (shot) await info.attach(`${name}.png`, { body: shot, contentType: "image/png" });
  }
});

test.afterAll(async () => {
  const ids = (await sql<{ id: string; tenant_id: string }[]>`select id, tenant_id from candidates where mobile in (${mobile}, ${lanMobile})`);
  const uploads = process.env.UPLOAD_DIR;
  for (const c of ids) {
    await sql`delete from candidate_files where candidate_id = ${c.id}`;
    await sql`delete from consents where candidate_id = ${c.id}`;
    await sql`delete from applications where candidate_id = ${c.id}`;
    await sql`delete from candidates where id = ${c.id}`;
    if (uploads && path.isAbsolute(uploads)) fs.rmSync(path.join(uploads, c.tenant_id, c.id), { recursive: true, force: true });
  }
  await sql`delete from jobs where title = ${jobTitle}`;
  await sql`delete from users where email = ${hr.email}`;
  await sql.end();
});

async function changePassword(page: Page, current: string, next: string) {
  await expect(page).toHaveURL(/\/account\/password$/);
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await page.getByLabel("Temporary password").fill(current);
  await page.getByLabel("New password", { exact: true }).fill(next);
  await page.getByLabel("Repeat new password").fill(next);
  await page.getByRole("button", { name: "Change password" }).click();
}

test("first sign-in with a temporary password forces a change", async () => {
  await signIn(adminPage, admin);
  await adminPage.goto("/dashboard/users");
  await adminPage.getByLabel("Full name").fill(hr.name);
  await adminPage.getByLabel("Email").fill(hr.email);
  await adminPage.getByLabel("Role", { exact: true }).selectOption("hr");
  await adminPage.getByLabel("Temporary password").fill(hr.password);
  await adminPage.getByRole("button", { name: "Add staff" }).click();
  await expect(adminPage.getByRole("status")).toContainText(`Added ${hr.name}`);
  await expect(adminPage.getByRole("row").filter({ hasText: hr.email })).toContainText("Temporary password");

  await signIn(hrPage, hr);
  await expect(hrPage).toHaveURL(/\/account\/password$/);
  await expect(hrPage.getByRole("link", { name: "+ New candidate" })).toHaveCount(0); // no nav yet
  for (const url of ["/intake", "/dashboard", "/"]) {
    await hrPage.goto(url);
    await expect(hrPage).toHaveURL(/\/account\/password$/);
  }
  const api = await hrPage.request.get(`/api/candidates/lookup?mobile=${mobile}`);
  expect(api.status()).toBe(403);

  await changePassword(hrPage, hr.password, hrFinal);
  await expect(hrPage).toHaveURL(/\/intake$/);
  const audit = await sql`select 1 from audit_log a join users u on u.id = a.entity_id where u.email = ${hr.email} and a.action = 'user.password_change' and a.meta->>'forced' = 'true'`;
  expect(audit.length).toBe(1);
});

test("admin password reset signs the user out and forces a change again", async () => {
  await adminPage.goto("/dashboard/users");
  await adminPage.getByRole("row").filter({ hasText: hr.email }).getByRole("button", { name: "Reset password" }).click();
  const reset = await adminPage.getByLabel("New temporary password").inputValue();
  expect(reset.length).toBeGreaterThanOrEqual(12);
  await adminPage.getByRole("button", { name: "Set temporary password" }).click();
  await expect(adminPage.getByRole("status")).toContainText(`New temporary password set for ${hr.name}`);

  await hrPage.goto("/intake");
  await expect(hrPage).toHaveURL(/\/login$/); // old session revoked
  await signIn(hrPage, { email: hr.email, password: reset });
  await changePassword(hrPage, reset, hrFinal + "x");
  await expect(hrPage).toHaveURL(/\/intake$/);
  const audit = await sql`select action from audit_log a join users u on u.id = a.entity_id where u.email = ${hr.email} order by a.id`;
  expect(audit.map((a) => a.action)).toEqual(["user.create", "user.password_change", "user.password_reset", "user.password_change"]);
});

// One browser runs both the admin PC and the tablet; only the front tab paints camera video.
const use = async (page: Page) => {
  await page.bringToFront();
  return page;
};

/**
 * Tap a capture button like HR would. If the app says the picture came out blank, tap again. If the
 * camera won't start, press "Try the camera again"; if it still won't, use the camera-app button the
 * app offers. (Headless Chrome's fake camera sometimes refuses to open at all: InvalidStateError /
 * NotFoundError, about 1 run in 10 on the dev PC, with no app code involved.)
 */
async function capture(page: Page, button: string) {
  const ready = page.getByRole("button", { name: button, exact: true, disabled: false });
  const restart = page.getByRole("button", { name: "Try the camera again" });
  let restarts = 0;
  for (let tries = 1; tries <= 10; tries++) {
    await expect(ready.or(restart)).toBeVisible({ timeout: 15_000 });
    if (await restart.isVisible()) {
      if (restarts++ < 2) {
        await restart.click();
        continue;
      }
      console.log(`${button}: fake camera would not start in this browser; used the camera-app fallback`);
      const jpeg = await page.screenshot({ type: "jpeg" });
      await page.locator("input[type=file][capture]").setInputFiles({ name: "shot.jpg", mimeType: "image/jpeg", buffer: jpeg });
      return;
    }
    // The camera can change state between the check and the tap; look again rather than wait forever.
    if (!(await ready.click({ timeout: 5_000 }).then(() => true, () => false))) continue;
    await expect(page.getByRole("button", { name: "Processing…" })).toHaveCount(0, { timeout: 10_000 });
    if (!(await page.getByText(/The picture came out blank|The camera was restarted/).isVisible())) {
      if (tries > 1) console.log(`${button}: accepted on try ${tries} (camera not ready or blank frame before)`);
      return;
    }
    await page.waitForTimeout(300);
  }
  throw new Error(`${button}: camera kept giving blank pictures`);
}

async function fillDetails(page: Page) {
  await page.getByRole("radio", { name: "Medical Coder", exact: true }).click();
  await page.getByLabel("Full name").fill(candidateName);
  await page.getByLabel("Date of birth").fill("1999-05-20");
  await page.getByLabel("Email (optional)").fill(`cand-${run}@${TEST_DOMAIN}`);
  await page.getByLabel("City").fill("Chandigarh");
  await page.getByLabel("Education").selectOption("B.Pharm");
  await page.getByLabel("Experience years").selectOption("1");
  await page.getByLabel("Experience months").selectOption("6");
  await page.getByLabel("Notice period").selectOption({ label: "15 days" });
  await page.getByLabel("Current CTC (LPA, optional)").fill("2.2");
  await page.getByLabel("Expected CTC (LPA, optional)").fill("3.1");
  await page.getByLabel("How did they hear about us?").selectOption("Employee referral");
  await page.getByRole("group", { name: "Languages spoken" }).getByRole("button", { name: "English" }).click();
  await page.getByRole("group", { name: "Languages spoken" }).getByRole("button", { name: "Punjabi" }).click();
  await page.getByRole("radiogroup", { name: "OK with night / US shift?" }).getByRole("radio", { name: "Yes" }).click();
  await page.getByRole("radiogroup", { name: "OK with voice process (calls)?" }).getByRole("radio", { name: "No" }).click();
  await page.getByRole("group", { name: "Certifications" }).getByRole("button", { name: "CPC", exact: true }).click();
  await page.getByRole("group", { name: "Coding specialties" }).getByRole("button", { name: "E/M" }).click();
  await page.getByRole("group", { name: "EHR / PM software" }).getByRole("button", { name: "Epic" }).click();
  await page.getByLabel("Typing speed (WPM, optional)").fill("38");
  await page.getByLabel("Skills (optional)").fill("ICD-10, CPT, denial follow-up");
}

test("full intake on the tablet: CV pages + photo → token", async () => {
  const page = await use(hrPage);
  await page.goto("/intake");
  await page.getByRole("textbox", { name: "Mobile number" }).fill(`+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`);
  await shoot(page, "intake-1-mobile", TABLET);
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByRole("status")).toContainText("New candidate");
  await page.getByRole("button", { name: /Next: details/ }).click();

  // Wrong inputs first: the form says what to fix.
  await page.getByRole("button", { name: /Next: consent/ }).click();
  await expect(page.getByText("Fix the fields marked in red.")).toBeVisible();
  await expect(page.getByText("Choose a position")).toBeVisible();
  await page.getByLabel("Date of birth").fill(`${new Date().getFullYear() - 16}-01-01`);
  await page.getByRole("button", { name: /Next: consent/ }).click();
  await expect(page.getByText("Candidate must be at least 18 years old")).toBeVisible();

  await fillDetails(page);
  await expect(page.locator("p.text-red-700")).toHaveCount(0); // each message cleared as its field was fixed
  await shoot(page, "intake-2-details", TABLET);
  await page.getByRole("button", { name: /Next: consent/ }).click();

  await expect(page.getByRole("heading", { name: "Please hand the tablet to the candidate" })).toBeVisible();
  await shoot(page, "intake-3a-handover", TABLET);
  await page.getByRole("button", { name: "The candidate has the tablet" }).click();
  await expect(page.getByRole("heading", { name: "How your information is used" })).toBeVisible();
  await expect(page.getByRole("button", { name: "I agree, continue" })).toBeDisabled();
  await page.getByRole("button", { name: "हिन्दी" }).click();
  await expect(page.getByRole("heading", { name: "आपकी जानकारी का उपयोग कैसे होगा" })).toBeVisible();
  await page.getByRole("checkbox", { name: /मैंने यह सूचना पढ़ ली है/ }).check();
  await page.getByRole("checkbox", { name: /टैलेंट पूल/ }).check();
  await shoot(page, "intake-3b-consent-hindi", TABLET);
  await page.getByRole("button", { name: "सहमत हूँ, आगे बढ़ें" }).click();
  await page.getByRole("button", { name: "HR: continue to CV" }).click();

  await capture(page, "Capture page 1");
  await capture(page, "Capture page 2");
  await expect(page.getByRole("list", { name: "Captured pages" }).getByRole("listitem")).toHaveCount(2);
  await shoot(page, "intake-4-cv", TABLET);
  await page.getByRole("button", { name: /Next: photo/ }).click();

  await capture(page, "Take photo");
  await expect(page.getByRole("img", { name: "Candidate photo" })).toBeVisible();
  await page.getByRole("button", { name: "Retake photo" }).click();
  await capture(page, "Take photo");
  await shoot(page, "intake-5-photo", TABLET);
  await page.getByRole("button", { name: /Next: save/ }).click();

  await expect(page.getByText("2 page photos")).toBeVisible();
  await expect(page.getByText(/Agreed \(हिन्दी\) · talent pool/)).toBeVisible();
  await shoot(page, "intake-6-save", TABLET);
  await page.getByRole("button", { name: "Save and get token" }).dblclick(); // double tap must not register twice
  await expect(page.getByTestId("token")).toHaveText(/^A-\d{3}$/);
  await expect(page.getByText(candidateName)).toBeVisible();
  await shoot(page, "intake-7-token", TABLET);

  const [app] = await sql`select a.id, a.token, (select count(*)::int from applications x where x.client_request_id = a.client_request_id) as n
    from applications a join candidates c on c.id = a.candidate_id where c.mobile = ${mobile}`;
  expect(app.n).toBe(1);
  const files = await sql`select kind, page_no, size_bytes, mime_type from candidate_files where application_id = ${app.id} order by kind, page_no`;
  expect(files.map((f) => `${f.kind}:${f.page_no ?? "-"}`)).toEqual(["photo:-", "cv_page:1", "cv_page:2"]); // enum order
  for (const f of files) expect(`${f.kind} ${f.mime_type} ${f.size_bytes > 1000 ? "has content" : `${f.size_bytes} bytes`}`).toBe(`${f.kind} image/jpeg has content`);
  const [consent] = await sql`select language, talent_pool, whatsapp from consents where application_id = ${app.id}`;
  expect(consent).toEqual({ language: "hi", talent_pool: true, whatsapp: false });
  const [c] = await sql`select current_ctc, expected_ctc, experience_months, certifications, ehr_software, night_shift_ok, voice_process, typing_wpm, languages from candidates where mobile = ${mobile}`;
  expect(c).toMatchObject({ current_ctc: 220000, expected_ctc: 310000, experience_months: 18, certifications: ["CPC"], ehr_software: ["Epic"], night_shift_ok: true, voice_process: false, typing_wpm: 38, languages: ["English", "Punjabi"] });
});

test("returning candidate is found and prefilled", async () => {
  const page = await use(hrPage);
  await page.getByRole("button", { name: "Next candidate" }).click();
  await page.getByRole("textbox", { name: "Mobile number" }).fill(mobile);
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByText("Returning candidate")).toBeVisible();
  await expect(page.getByText(candidateName)).toBeVisible();
  await expect(page.getByRole("img", { name: "Last photo" })).toBeVisible();
  await expect(page.getByText(/Already registered today: token A-\d{3}/)).toBeVisible();
  await expect(page.getByRole("table")).toContainText("Medical Coder");
  await shoot(page, "intake-1b-returning", TABLET);
  await page.getByRole("button", { name: /Continue with this candidate/ }).click();

  await expect(page.getByLabel("Full name")).toHaveValue(candidateName);
  await expect(page.getByLabel("City")).toHaveValue("Chandigarh");
  await expect(page.getByLabel("Expected CTC (LPA, optional)")).toHaveValue("3.1");
  await expect(page.getByRole("radio", { name: "Medical Coder", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("group", { name: "Certifications" }).getByRole("button", { name: "CPC", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "EHR / PM software" }).getByRole("button", { name: "Epic" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Typing speed (WPM, optional)")).toHaveValue("38");
});

test("cooldown banner shows for HR, never on the candidate's consent screen", async () => {
  const page = await use(hrPage);
  await sql`update applications set outcome = 'rejected', reject_reason = 'Typing speed below requirement'
    where candidate_id = (select id from candidates where mobile = ${mobile})`;
  await page.getByRole("button", { name: "← Back" }).click(); // back to the mobile step
  await page.getByRole("button", { name: "Find" }).click();
  const banner = page.getByRole("alert").filter({ hasText: "Cooldown" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Typing speed below requirement");
  await shoot(page, "intake-1c-cooldown", TABLET);

  await page.getByRole("button", { name: /Continue with this candidate/ }).click();
  await page.getByLabel("How did they hear about us?").selectOption("Walk-in (saw the board / heard nearby)");
  await page.getByRole("button", { name: /Next: consent/ }).click();
  await page.getByRole("button", { name: "The candidate has the tablet" }).click();
  await expect(page.getByRole("heading", { name: "How your information is used" })).toBeVisible();
  await expect(page.getByText("Cooldown")).toHaveCount(0);
  await expect(page.getByText("Typing speed below requirement")).toHaveCount(0);
  // The notice covers the staff header, so the candidate can't open the candidate list.
  const covered = await page.evaluate(() => {
    const link = [...document.querySelectorAll("header a")].find((a) => a.textContent === "Candidates");
    if (!link) return false;
    const r = link.getBoundingClientRect();
    return !link.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  });
  expect(covered).toBe(true);
  await page.goBack(); // Android back button: stays on the notice
  await expect(page.getByRole("heading", { name: "How your information is used" })).toBeVisible();
  await page.getByRole("button", { name: "I do not agree" }).click();
  await page.getByRole("button", { name: "Cancel this candidate" }).click();
  await expect(page.getByRole("textbox", { name: "Mobile number" })).toHaveValue("");
});

test("admin: candidate list, profile and settings", async () => {
  const page = await use(adminPage);
  await page.goto(`/dashboard?q=${mobile.slice(-6)}`);
  await expect(page.getByRole("link", { name: candidateName })).toBeVisible();
  await page.goto("/dashboard");
  await shoot(page, "dashboard");
  await page.goto(`/dashboard?q=${encodeURIComponent(candidateName)}`);
  await page.getByRole("link", { name: candidateName }).click();
  await expect(page.getByRole("heading", { name: candidateName })).toBeVisible();
  await expect(page.getByText("Page 2")).toBeVisible();
  await expect(page.getByText("draft-")).toBeVisible();
  await expect(page.getByText("3.1 LPA")).toBeVisible();
  await shoot(page, "profile");

  await page.goto("/dashboard/settings");
  await shoot(page, "settings");
  const add = page.getByRole("region", { name: "Add a job" });
  await add.getByLabel("Job title").fill(jobTitle);
  await add.getByLabel("Status").selectOption("paused");
  await add.getByLabel("Openings").fill("2");
  await add.getByLabel("Min experience (years)").fill("3");
  await add.getByLabel("Max experience (years)").fill("1");
  await add.getByRole("button", { name: "CPC", exact: true }).click();
  await add.getByRole("button", { name: "Add job" }).click();
  await expect(page.locator(".alert-error")).toContainText("Minimum experience can't be more than the maximum");
  await add.getByLabel("Max experience (years)").fill("5");
  await add.getByRole("button", { name: "Add job" }).click();
  await expect(page.getByRole("status")).toContainText("Job added.");

  const card = page.getByRole("article", { name: jobTitle });
  await expect(card).toContainText("Paused");
  await card.getByLabel("Status").selectOption("open");
  await card.getByLabel("Openings").fill("4");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText(`Saved ${jobTitle}.`);
  await expect(page.getByRole("article", { name: jobTitle })).toContainText("Open");
  const [job] = await sql`select id, status, openings, min_experience_years, max_experience_years, required_certifications, active from jobs where title = ${jobTitle}`;
  expect(job).toMatchObject({ status: "open", openings: 4, min_experience_years: 3, max_experience_years: 5, required_certifications: ["CPC"], active: true });
  const audits = await sql`select action, meta from audit_log where entity_id = ${job.id} order by id`;
  expect(audits.map((a) => a.action)).toEqual(["job.create", "job.update"]);
  expect(audits[1].meta).toMatchObject({ changed: "status,openings", status: "open" });

  const loc = page.getByLabel("Location name");
  const original = await loc.inputValue();
  await loc.fill(`${original} E2E`);
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("status")).toContainText("Location renamed");
  await page.getByLabel("Location name").fill(original);
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("status")).toContainText(`Location renamed to ${original}.`);
});

// Plain-http LAN address (how tablets reach the office PC): the browser blocks the live camera,
// so the camera-app fallback must work end to end. Set E2E_LAN_URL, e.g. http://192.168.1.20:3000.
test("intake over the LAN address uses the camera-app fallback", async ({ browser }: { browser: Browser }) => {
  const lan = process.env.E2E_LAN_URL;
  test.skip(!lan, "E2E_LAN_URL not set");
  const page = await (await browser.newContext({ baseURL: lan, viewport: TABLET })).newPage();
  await signIn(page, { email: hr.email, password: hrFinal + "x" });
  await expect(page).toHaveURL(/\/intake$/);
  const jpeg = await page.screenshot({ type: "jpeg" }); // any real JPEG will do as a "camera" shot

  await page.getByRole("textbox", { name: "Mobile number" }).fill(lanMobile);
  await page.getByRole("button", { name: "Find" }).click();
  await page.getByRole("button", { name: /Next: details/ }).click();
  await fillDetails(page);
  await page.getByLabel("Full name").fill(`${candidateName} LAN`);
  await page.getByLabel("Email (optional)").fill("");
  await page.getByRole("button", { name: /Next: consent/ }).click();
  await page.getByRole("button", { name: "The candidate has the tablet" }).click();
  await page.getByRole("checkbox", { name: /I have read this notice/ }).check();
  await page.getByRole("button", { name: "I agree, continue" }).click();
  await page.getByRole("button", { name: "HR: continue to CV" }).click();

  await expect(page.getByText("Camera needs HTTPS — open the https:// address")).toBeVisible();
  await shoot(page, "intake-4b-cv-lan-fallback", TABLET);
  await page.locator('input[type=file][capture="environment"]').setInputFiles({ name: "page.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await expect(page.getByRole("list", { name: "Captured pages" }).getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: /Next: photo/ }).click();
  await expect(page.getByText("Camera needs HTTPS — open the https:// address")).toBeVisible();
  await page.locator('input[type=file][capture="user"]').setInputFiles({ name: "face.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await expect(page.getByRole("img", { name: "Candidate photo" })).toBeVisible();
  await page.getByRole("button", { name: /Next: save/ }).click();
  await page.getByRole("button", { name: "Save and get token" }).click();
  await expect(page.getByTestId("token")).toHaveText(/^A-\d{3}$/);
  // Same DOB and a near-identical name under another mobile → flagged for HR.
  await expect(page.getByText("For HR: possible duplicate under another mobile")).toBeVisible();
  await page.context().close();
});
