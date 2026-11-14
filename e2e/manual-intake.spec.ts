import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { signIn } from "./helpers";
import { removeFiles } from "./storage";

// PERMANENT RULE (CLAUDE.md): HR can always register a candidate by typing every field by hand.
// No CV, no webcam, no auto-fill, nothing from the internet: the photo comes from the upload fallback.
const admin = { email: process.env.SEED_ADMIN_EMAIL!, password: process.env.SEED_ADMIN_PASSWORD! };
const run = Date.now().toString(36);
const mobile = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const name = `E2E Manual ${run}`;
const sql = postgres(process.env.DATABASE_URL!);

test.afterAll(async () => {
  for (const c of await sql<{ id: string; tenant_id: string }[]>`select id, tenant_id from candidates where mobile = ${mobile}`) {
    await sql`delete from candidate_files where candidate_id = ${c.id}`;
    await sql`delete from consents where candidate_id = ${c.id}`;
    await sql`delete from applications where candidate_id = ${c.id}`;
    await sql`delete from candidates where id = ${c.id}`;
    await removeFiles(`${c.tenant_id}/${c.id}/`); // the server's storage (folder or S3)
  }
  await sql.end();
});

test("manual-only intake: every field typed, no CV, no webcam, photo uploaded", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: "en-IN" });
  // This PC has no webcam at all (overrides the fake webcams from playwright.config.ts).
  await context.addInitScript(() => {
    const md = navigator.mediaDevices;
    if (!md) return;
    md.enumerateDevices = async () => [];
    md.getUserMedia = async () => {
      throw new DOMException("Requested device not found", "NotFoundError");
    };
  });
  const page = await context.newPage();
  const origin = new URL(baseURL!).origin;
  const offsite: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["data:", "blob:"].includes(u.protocol) && u.origin !== origin) offsite.push(r.url());
  });

  await signIn(page, admin);
  await page.goto("/intake");
  await page.getByRole("textbox", { name: "Mobile number" }).fill(mobile);
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByRole("status")).toContainText("New candidate");
  await page.getByRole("button", { name: "Next: details →" }).click();

  // Every field, typed or picked by hand (nothing is pre-filled for a new candidate).
  await expect(page.getByLabel("Full name")).toHaveValue("");
  await page.getByRole("radio", { name: "AR Caller / AR Analyst", exact: true }).click();
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Date of birth").fill("1997-08-03");
  await page.getByLabel("Email (optional)").fill(`manual-${run}@e2e.example.test`);
  await page.getByLabel("City").fill("Mohali");
  await page.getByLabel("Education").selectOption("B.Com");
  await page.getByLabel("Experience years").selectOption("2");
  await page.getByLabel("Experience months").selectOption("3");
  await page.getByLabel("Notice period").selectOption({ label: "30 days" });
  await page.getByLabel("Current CTC (LPA, optional)").fill("2.8");
  await page.getByLabel("Expected CTC (LPA, optional)").fill("3.6");
  await page.getByLabel("How did they hear about us?").selectOption("Employee referral");
  await page.getByRole("group", { name: "Languages spoken" }).getByRole("button", { name: "Hindi" }).click();
  await page.getByRole("radiogroup", { name: "OK with night / US shift?" }).getByRole("radio", { name: "Yes" }).click();
  await page.getByRole("radiogroup", { name: "OK with voice process (calls)?" }).getByRole("radio", { name: "Yes" }).click();
  await page.getByRole("group", { name: "Certifications" }).getByRole("button", { name: "CPC", exact: true }).click();
  await page.getByRole("group", { name: "EHR / PM software" }).getByRole("button", { name: "Epic" }).click();
  await page.getByLabel("Typing speed (WPM, optional)").fill("42");
  await page.getByLabel("Skills (optional)").fill("AR follow-up, denials, Excel");
  await page.getByLabel("Notes for the interview panel (optional)").fill("Typed by hand at the desk");
  await page.getByRole("button", { name: /Next: consent/ }).click();

  await page.getByRole("button", { name: "The candidate can see the screen" }).click();
  await page.getByRole("checkbox", { name: /I have read this notice/ }).check();
  await page.getByRole("button", { name: "I agree, continue" }).click();
  await page.getByRole("button", { name: "HR: continue to CV" }).click();

  // No CV at all.
  await page.getByRole("button", { name: "Skip CV →" }).click();

  // No webcam: the app says so and offers the upload.
  await expect(page.getByText(/No webcam found/)).toBeVisible();
  const jpeg = await page.screenshot({ type: "jpeg" }); // any real JPEG will do as the photo
  await page.getByTestId("camera-upload").setInputFiles({ name: "photo.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await expect(page.getByRole("img", { name: "Candidate photo" })).toBeVisible();
  await page.getByRole("button", { name: /Next: save/ }).click();
  await page.getByRole("button", { name: "Save and get token" }).click();
  await expect(page.getByTestId("token")).toHaveText(/^A-\d{3}$/);

  const [c] = await sql`select id, full_name, date_of_birth::text as dob, email, city, qualification, experience_months, notice_days,
      current_ctc, expected_ctc, languages, night_shift_ok, voice_process, certifications, ehr_software, typing_wpm, skills
    from candidates where mobile = ${mobile}`;
  expect(c).toMatchObject({
    full_name: name, dob: "1997-08-03", email: `manual-${run}@e2e.example.test`, city: "Mohali", qualification: "B.Com",
    experience_months: 27, notice_days: 30, current_ctc: 280000, expected_ctc: 360000,
    languages: ["Hindi"], night_shift_ok: true, voice_process: true, certifications: ["CPC"], ehr_software: ["Epic"],
    typing_wpm: 42, skills: "AR follow-up, denials, Excel",
  });
  const [a] = await sql`select source, hr_notes from applications where candidate_id = ${c.id}`;
  expect(a).toEqual({ source: "Employee referral", hr_notes: "Typed by hand at the desk" });
  const files = await sql`select kind from candidate_files where candidate_id = ${c.id}`;
  expect(files.map((f) => f.kind)).toEqual(["photo"]); // photo only, no CV
  expect(offsite).toEqual([]); // nothing left the office server
  await context.close();
});
