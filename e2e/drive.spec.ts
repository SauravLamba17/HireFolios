import fs from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import postgres from "postgres";
import { shoot, signIn, VIEWPORTS } from "./helpers";

// A full drive day in a throwaway tenant (two interview rounds), deleted afterwards.
// HR, a manager, two interviewers and the lobby TV use separate browser contexts at the same time,
// so updates on one screen must reach the others without a reload (Server-Sent Events).
const run = Date.now().toString(36);
const sql = postgres(process.env.DATABASE_URL!);
const SHOTS = process.env.SHOTS_DIR;
type Who = { id: string; email: string; password: string };
const who: Record<"hr" | "i1" | "i2" | "mgr" | "tv", Who> = {} as never;
let tenantId = "";
let jobId = "";
const names = ["Asha", "Bilal", "Chitra", "Deepak"].map((n) => `${n} E2E${run}`);
const tokens: Record<string, string> = {};
const pages: Record<string, Page> = {};

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const [t] = await sql`insert into tenants (name, slug, token_prefix) values ('E2E Drive Co', ${`e2e-drive-${run}`}, 'ED') returning id`;
  tenantId = t.id;
  await sql`insert into locations (tenant_id, name) values (${tenantId}, 'E2E office')`;
  await sql`insert into stages (tenant_id, name, position, is_interview, criteria) values
    (${tenantId}, 'Registered', 1, false, '[]'),
    (${tenantId}, 'HR screen', 2, true, ${sql.json([{ label: "Communication", required: true }, { label: "Attitude & stability", required: false }])}),
    (${tenantId}, 'Manager round', 3, true, ${sql.json([{ label: "Process knowledge", required: false }])}),
    (${tenantId}, 'Offer', 4, false, '[]')`;
  await sql`insert into reject_reasons (tenant_id, label, position) values (${tenantId}, 'Spoken English / communication', 1), (${tenantId}, 'Notice period too long', 2)`;
  [{ id: jobId }] = await sql`insert into jobs (tenant_id, title) values (${tenantId}, 'E2E Coder') returning id`;
  for (const [key, role, name] of [
    ["hr", "hr", "E2E Drive HR"],
    ["i1", "interviewer", "E2E Interviewer One"],
    ["i2", "interviewer", "E2E Interviewer Two"],
    ["mgr", "manager", "E2E Manager"],
    ["tv", "display", "E2E Lobby TV"],
  ] as const) {
    const id = crypto.randomUUID();
    const email = `${key}-${run}@e2e-drive.example.test`;
    const password = `Pw-${crypto.randomUUID().slice(0, 12)}`;
    await sql`insert into users (id, name, email, role, tenant_id) values (${id}, ${name}, ${email}, ${role}, ${tenantId})`;
    await sql`insert into accounts (id, account_id, provider_id, user_id, password) values (${crypto.randomUUID()}, ${id}, 'credential', ${id}, ${await hashPassword(password)})`;
    who[key] = { id, email, password };
  }
  for (const [key, viewport] of [
    ["hr", { width: 1440, height: 900 }],
    ["mgr", { width: 1440, height: 900 }],
    ["i1", { width: 1440, height: 900 }],
    ["i2", { width: 1024, height: 768 }],
    ["tv", { width: 1920, height: 1080 }],
  ] as const) {
    pages[key] = await (await browser.newContext({ viewport })).newPage();
    await signIn(pages[key], who[key]);
  }
});

test.afterAll(async () => {
  for (const p of Object.values(pages)) await p.context().close(); // stop live refreshes before deleting the drive
  const t = [tenantId];
  const cands = await sql`select id from candidates where tenant_id in ${sql(t)}`;
  for (const q of ["scorecards", "queue_events", "candidate_files", "consents"]) await sql`delete from ${sql(q)} where tenant_id in ${sql(t)}`;
  await sql`delete from applications where tenant_id in ${sql(t)}`;
  await sql`delete from panels where tenant_id in ${sql(t)}`;
  await sql`delete from drives where tenant_id in ${sql(t)}`;
  for (const q of ["candidates", "daily_counters", "audit_log", "reject_reasons", "option_items", "privacy_notices", "users", "jobs", "stages", "locations"]) await sql`delete from ${sql(q)} where tenant_id in ${sql(t)}`;
  await sql`delete from tenants where id = ${tenantId}`;
  const up = process.env.UPLOAD_DIR;
  if (up && path.isAbsolute(up)) fs.rmSync(path.join(up, tenantId), { recursive: true, force: true });
  void cands;
  await sql.end();
});

const board = () => pages.hr;
const panelCard = (p: Page, room: string) => p.getByRole("article", { name: `Panel ${room}` });

async function decide(p: Page, scores: [string, number][], decision: "Pass" | "Hold" | "Reject", reason?: string) {
  for (const [crit, n] of scores) await p.getByRole("radio", { name: `${crit}: ${n}` }).click();
  await p.getByRole("radio", { name: decision, exact: true }).click();
  if (reason) await p.getByLabel("Reject reason").selectOption(reason);
  await p.getByRole("button", { name: "Submit and free the panel" }).click();
}

test("HR registers 4 walk-ins; they wait for the HR screen", async () => {
  const p = board();
  await p.goto("/login");
  const jpeg = await p.screenshot({ type: "jpeg" });
  // the version in use (Settings → Privacy notice); the server refuses any other
  const [{ version: NOTICE_VERSION }] = await sql`select n.version from privacy_notices n join users u on u.tenant_id = n.tenant_id where u.email = ${process.env.SEED_ADMIN_EMAIL!} and n.status = 'active'`;
  for (const [i, name] of names.entries()) {
    const res = await p.request.post("/api/intake", {
      multipart: {
        data: JSON.stringify({
          clientRequestId: crypto.randomUUID(),
          mobile: `9${String(Date.now()).slice(-6)}${i}00`.slice(0, 10),
          details: {
            jobId, fullName: name, dateOfBirth: "1998-01-0" + (i + 1), email: "", city: "Mohali", education: "BA", experienceYears: 1, experienceMonths: 0,
            currentCtcLpa: null, expectedCtcLpa: 3, noticeDays: 0, languages: [], source: "Other", hrNotes: "", certifications: [], codingSpecialties: [],
            ehrSoftware: [], nightShiftOk: true, voiceProcess: true, typingWpm: null, skills: "",
          },
          consent: { agreed: true, language: "en", noticeVersion: NOTICE_VERSION, talentPool: false, whatsapp: false },
        }),
        photo: { name: "p.jpg", mimeType: "image/jpeg", buffer: jpeg },
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    tokens[name] = (await res.json()).token;
    await p.waitForTimeout(20); // distinct registration times → a clear queue order
  }
  await p.goto("/dashboard/drive");
  await expect(p.getByRole("list", { name: "Waiting for HR screen" }).getByRole("listitem")).toHaveCount(4);
  await pages.mgr.goto("/dashboard/drive"); // the manager watches the same board, read-only
  await expect(pages.mgr.getByRole("button", { name: "Add panel" })).toHaveCount(0);
  await pages.tv.goto("/tv");
  await expect(pages.tv.getByTestId("tv-waiting")).toHaveText("Waiting: 4");
});

test("HR sets up two panels and assigns next twice; other screens update live", async () => {
  const p = board();
  const form = p.getByRole("form", { name: "Add a panel" });
  for (const [room, iv] of [["Room 1", "E2E Interviewer One"], ["Room 2", "E2E Interviewer Two"]]) {
    await form.getByLabel("Room").fill(room);
    await form.getByLabel("Interviewer").selectOption({ label: `${iv} (Interviewer)` });
    await form.getByLabel("Round").selectOption({ label: "HR screen" });
    await form.getByRole("button", { name: "Add panel" }).click();
    await expect(panelCard(p, room)).toBeVisible();
  }
  await expect(pages.mgr.getByRole("article", { name: "Panel Room 2" })).toBeVisible(); // arrived without a reload
  await panelCard(p, "Room 1").getByRole("button", { name: "Assign next" }).click();
  await expect(panelCard(p, "Room 1")).toContainText(tokens[names[0]]);
  await panelCard(p, "Room 2").getByRole("button", { name: "Assign next" }).click();
  await expect(panelCard(p, "Room 2")).toContainText(tokens[names[1]]);
  await expect(panelCard(pages.mgr, "Room 2")).toContainText(names[1]);
  await shoot(p, "drive-board");

  const tv = pages.tv;
  await expect(tv.getByTestId("tv-now")).toHaveText(tokens[names[1]]);
  await expect(tv.getByTestId("tv-room")).toHaveText("→ Room 2");
  await expect(tv.getByTestId("tv-previous")).toContainText(`${tokens[names[0]]} → Room 1`);
  await expect(tv.getByTestId("tv-waiting")).toHaveText("Waiting: 2");
  const tvText = await tv.locator("body").innerText();
  for (const n of names) expect(tvText).not.toContain(n.split(" ")[0]);
  await expect(tv.locator("img")).toHaveCount(0);
  if (SHOTS) await tv.screenshot({ path: path.join(SHOTS, "tv-1920x1080.png") });
  await shoot(tv, "tv", { width: 1920, height: 1080 });
});

test("interviewer 1 passes A (next round); interviewer 2 rejects B with a reason", async () => {
  const i1 = pages.i1;
  await i1.goto("/interview");
  await expect(i1.getByRole("heading", { name: names[0] })).toBeVisible();
  await expect(i1.getByText("This is the first round.")).toBeVisible();
  await shoot(i1, "interview", { width: 1440, height: 900 });
  await i1.getByRole("radio", { name: "Pass", exact: true }).click();
  await i1.getByRole("button", { name: "Submit and free the panel" }).click();
  await expect(i1.getByRole("alert").filter({ hasText: "Communication" })).toBeVisible(); // required criterion
  await decide(i1, [["Communication", 4], ["Attitude & stability", 5]], "Pass");
  await expect(i1.getByText("Waiting for HR to send the next candidate.")).toBeVisible();

  const i2 = pages.i2;
  await i2.goto("/interview");
  await expect(i2.getByRole("heading", { name: names[1] })).toBeVisible();
  await i2.getByRole("radio", { name: "Communication: 2" }).click();
  await i2.getByRole("radio", { name: "Reject", exact: true }).click();
  await i2.getByRole("button", { name: "Submit and free the panel" }).click();
  await expect(i2.getByText("Choose a reject reason.")).toBeVisible();
  await decide(i2, [["Communication", 2]], "Reject", "Spoken English / communication");
  await expect(i2.getByText("Waiting for HR to send the next candidate.")).toBeVisible();

  const p = board();
  await expect(p.getByRole("list", { name: "Waiting for Manager round" })).toContainText(names[0]);
  await expect(p.getByTestId("done-rejected")).toContainText("1");
  const [b] = await sql`select outcome, reject_reason, purge_after, decided_at from applications where token = ${tokens[names[1]]} and tenant_id = ${tenantId}`;
  expect(b.outcome).toBe("rejected");
  expect(b.reject_reason).toBe("Spoken English / communication");
  expect(b.purge_after).not.toBeNull();
});

test("A passes the final round → Selected; HR marks C no-show; manager overrides D; end of day summary", async () => {
  const p = board();
  const room1 = panelCard(p, "Room 1");
  await room1.getByRole("button", { name: "Edit" }).click();
  await room1.getByLabel("Round").selectOption({ label: "Manager round" });
  await room1.getByRole("button", { name: "Save" }).click();
  await expect(room1).toContainText("Manager round");
  await room1.getByRole("button", { name: "Assign next" }).click();
  await expect(room1).toContainText(names[0]);
  const i1 = pages.i1;
  await expect(i1.getByRole("heading", { name: names[0] })).toBeVisible(); // arrived live
  await expect(i1.getByText("HR screen · E2E Interviewer One · Pass")).toBeVisible(); // previous round shown
  await decide(i1, [["Process knowledge", 4]], "Pass");
  await expect(p.getByTestId("done-selected")).toContainText("1");

  p.once("dialog", (d) => d.accept());
  await p.getByRole("list", { name: "Waiting for HR screen" }).getByRole("listitem").filter({ hasText: names[2] }).getByRole("button", { name: "No-show" }).click();
  await expect(p.getByTestId("done-no_show")).toContainText("1");

  const [d] = await sql`select c.id from candidates c where c.full_name = ${names[3]} and c.tenant_id = ${tenantId}`;
  const m = pages.mgr;
  await m.goto(`/dashboard/candidates/${d.id}`);
  await m.getByText("Manager override").click();
  await m.getByLabel("Set outcome").selectOption("on_hold");
  await m.locator("#ov-outcome-reason").fill("Strong profile, waiting for client approval");
  await m.getByRole("button", { name: "Change outcome" }).click();
  await expect(m.getByRole("status").filter({ hasText: "Outcome changed." })).toBeVisible();
  await shoot(m, "profile-timeline");
  await expect(p.getByTestId("done-on_hold")).toContainText("1");

  p.once("dialog", (dl) => dl.accept());
  await p.getByRole("button", { name: "End of day" }).click();
  await expect(p.getByRole("heading", { name: /Day closed at/ })).toBeVisible();
  const summary = async (k: string) => (await p.getByTestId(`summary-${k}`).innerText()).trim();
  expect(await summary("Registered")).toBe("4");
  expect(await summary("Interviews finished")).toBe("3");
  expect(await summary("Selected")).toBe("1");
  expect(await summary("Rejected")).toBe("1");
  expect(await summary("On hold")).toBe("1");
  expect(await summary("No show")).toBe("1");
  expect(await summary("Walked away")).toBe("0");
  expect(await summary("Still waiting")).toBe("0");
  await expect(pages.mgr.getByText("Outcome changed.")).toBeVisible();
  await pages.mgr.goto("/dashboard/drive");
  await expect(pages.mgr.getByRole("heading", { name: /Day closed at/ })).toBeVisible();
  await shoot(p, "drive-end-of-day");

  const [a] = await sql`select a.outcome, s.name as stage from applications a join stages s on s.id = a.current_stage_id where a.token = ${tokens[names[0]]} and a.tenant_id = ${tenantId}`;
  expect(a).toEqual({ outcome: "selected", stage: "Offer" });
  const audit = await sql`select action from audit_log where tenant_id = ${tenantId}`;
  for (const act of ["panel.open", "queue.assign", "interview.decision", "application.outcome", "application.override", "drive.close"]) expect(audit.map((x) => x.action)).toContain(act);
  void VIEWPORTS;
});
