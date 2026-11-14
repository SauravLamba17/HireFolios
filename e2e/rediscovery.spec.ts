import fs from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import ExcelJS from "exceljs";
import postgres from "postgres";
import { shoot, signIn } from "./helpers";
import { removeFiles } from "./storage";

// Phase 3.6 (docs/REDISCOVERY.md): candidate 360 + rediscovery, in a throwaway tenant whose rows are made here.
const run = Date.now().toString(36);
const sql = postgres(process.env.DATABASE_URL!);
type Who = { id: string; email: string; password: string; name: string };
const who: Record<"admin" | "hr" | "mgr" | "iv", Who> = {} as never;
const pages: Record<string, Page> = {};
let tenantId = "";
let jobId = "";
const stage: Record<string, string> = {};
const people: Record<string, { id: string; appId: string; mobile: string; name: string }> = {};
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const daysAgo = (d: number) => new Date(Date.now() - d * 864e5);

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

/** A candidate with one visit (outcome, category) and scorecards per round [stage, scores]. */
async function person(key: string, o: { name: string; outcome: string; reason?: string | null; category?: string | null; stageName: string; cards: [string, Record<string, number>][]; expected?: number; city?: string; decidedDaysAgo?: number; token?: string }) {
  const mobile = `8${String(Date.now()).slice(-6)}${String(Object.keys(people).length).padStart(3, "0")}`;
  const [c] = await sql`insert into candidates (tenant_id, full_name, mobile, date_of_birth, city, qualification, experience_months, expected_ctc, notice_days, certifications, ehr_software, night_shift_ok, voice_process, search_text)
    values (${tenantId}, ${o.name}, ${mobile}, '1996-05-05', ${o.city ?? "Mohali"}, 'B.Com', 30, ${o.expected ?? 380000}, 30, ${["CPC"]}, ${["Epic"]}, true, true, ${o.name + " Mohali B.Com CPC Epic"}) returning id`;
  const decided = o.outcome === "in_progress" ? null : daysAgo(o.decidedDaysAgo ?? 1);
  const [a] = await sql`insert into applications (tenant_id, candidate_id, job_id, location_id, token, token_date, current_stage_id, outcome, reject_reason, reject_category, client_request_id, decided_at, purge_after, photo_purge_after)
    values (${tenantId}, ${c.id}, ${jobId}, ${stage.loc}, ${o.token ?? `R-${Object.keys(people).length + 1}`}, ${today}, ${stage[o.stageName]}, ${o.outcome}, ${o.reason ?? null}, ${o.category ?? null}, ${crypto.randomUUID()}, ${decided},
      ${decided ? new Date(Date.now() + 365 * 864e5) : null}, ${decided ? new Date(Date.now() + 180 * 864e5) : null}) returning id`;
  await sql`insert into consents (tenant_id, candidate_id, application_id, notice_version, language, whatsapp) values (${tenantId}, ${c.id}, ${a.id}, 'test', 'en', true)`;
  for (const [st, scores] of o.cards) {
    await sql`insert into scorecards (tenant_id, application_id, stage_id, interviewer_id, scores, overall, decision) values (${tenantId}, ${a.id}, ${stage[st]}, ${who.iv.id}, ${sql.json(scores)}, ${Math.round(Object.values(scores).reduce((x, y) => x + y, 0) / Object.values(scores).length)}, 'pass')`;
  }
  people[key] = { id: c.id, appId: a.id, mobile, name: o.name };
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const [t] = await sql`insert into tenants (name, slug, token_prefix, profile_sample) values ('E2E Rediscovery Co', ${`e2e-rd-${run}`}, 'R', false) returning id`;
  tenantId = t.id;
  const [loc] = await sql`insert into locations (tenant_id, name) values (${tenantId}, 'RD office') returning id`;
  stage.loc = loc.id;
  const crit = sql.json([{ label: "Communication", required: false }, { label: "Knowledge", required: false }]);
  const st = await sql`insert into stages (tenant_id, name, position, is_interview, criteria) values
    (${tenantId}, 'Registered', 1, false, '[]'), (${tenantId}, 'HR screen', 2, true, ${crit}), (${tenantId}, 'Manager round', 3, true, ${crit}), (${tenantId}, 'Offer', 4, false, '[]') returning id, name`;
  for (const s of st) stage[s.name] = s.id;
  const [job] = await sql`insert into jobs (tenant_id, title) values (${tenantId}, 'RD AR Caller') returning id`;
  jobId = job.id;
  const reasons = [
    ["Salary expectation above budget", "cost"],
    ["Position filled / better candidate chosen", "seat_filled"],
    ["No relevant RCM experience", "knowledge"],
  ];
  for (const [i, [label, code]] of reasons.entries()) await sql`insert into reject_reasons (tenant_id, label, position, category_code) values (${tenantId}, ${label}, ${i + 1}, ${code})`;
  for (const [key, role] of [["admin", "admin"], ["hr", "hr"], ["mgr", "manager"], ["iv", "interviewer"]] as const) {
    const id = crypto.randomUUID();
    const email = `${key}-${run}@e2e-rd.example.test`;
    const password = `Pw-${crypto.randomUUID().slice(0, 12)}`;
    const name = `RD ${key}`;
    await sql`insert into users (id, name, email, role, tenant_id) values (${id}, ${name}, ${email}, ${role}, ${tenantId})`;
    await sql`insert into accounts (id, account_id, provider_id, user_id, password) values (${crypto.randomUUID()}, ${id}, 'credential', ${id}, ${await hashPassword(password)})`;
    who[key] = { id, email, password, name };
  }
  // P1: strong, waiting for the manager's decision; P2: rejected at the last round, seat filled; P3: rejected for skills
  await person("P1", { name: `Priya Costly ${run}`, outcome: "in_progress", stageName: "Manager round", cards: [["HR screen", { Communication: 4, Knowledge: 4 }], ["Manager round", { Communication: 4, Knowledge: 5 }]], expected: 420000 });
  await person("P2", { name: `Seema Seat ${run}`, outcome: "rejected", reason: "Position filled / better candidate chosen", category: "seat_filled", stageName: "Manager round", cards: [["HR screen", { Communication: 3, Knowledge: 3 }], ["Manager round", { Communication: 3, Knowledge: 3 }]] });
  await person("P3", { name: `Dinesh Skills ${run}`, outcome: "rejected", reason: "No relevant RCM experience", category: "knowledge", stageName: "HR screen", cards: [["HR screen", { Communication: 2, Knowledge: 2 }]] });
  for (const [key, viewport] of [["hr", { width: 1366, height: 768 }], ["mgr", { width: 1440, height: 900 }], ["iv", { width: 1366, height: 768 }]] as const) {
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
  // Phase 3.6 tables cascade with candidates / tenant
  for (const q of ["candidates", "daily_counters", "audit_log", "reject_reasons", "option_items", "privacy_notices", "users", "jobs", "stages", "locations"]) await sql`delete from ${sql(q)} where tenant_id in ${sql(t)}`;
  await sql`delete from tenants where id = ${tenantId}`;
  await removeFiles(`${tenantId}/`);
  await sql.end();
});

test("B: manager rejects a strong candidate for Cost (with figures) → suggestion → HR accepts", async () => {
  const m = pages.mgr;
  await m.goto(`/dashboard/candidates/${people.P1.id}`);
  await m.getByText("Manager override").click();
  await m.getByLabel("Set outcome").selectOption("rejected");
  await m.getByLabel("Reject reason").selectOption("Salary expectation above budget");
  await expect(m.getByTestId("reject-category")).toHaveText("Category: Cost / salary expectation");
  await expect(m.getByLabel("Candidate's expected CTC (LPA)")).toHaveValue("4.2"); // prefilled from the profile
  await m.getByLabel("Our budget (LPA)").fill("3");
  await shoot(m, "reject-form-cost", { width: 1440, height: 900 });
  await m.getByLabel("Reason", { exact: true }).last().fill("Budget for this batch is 3 LPA");
  await m.getByRole("button", { name: "Change outcome" }).click();
  await expect(m.getByText("Outcome changed.")).toBeVisible();
  const [a] = await sql`select reject_category, cost_expected_ctc, cost_budget_ctc from applications where id = ${people.P1.appId}`;
  expect(a).toEqual({ reject_category: "cost", cost_expected_ctc: 420000, cost_budget_ctc: 300000 });

  const h = pages.hr;
  await h.goto(`/dashboard/candidates/${people.P1.id}`);
  const card = h.getByTestId("summary-card");
  await expect(card.getByTestId("summary-line")).toHaveText("Not hired — Cost / salary expectation: asked 4.2 vs budget 3.0 LPA (+40%) · reached Manager round · avg 4.3/5");
  const sug = card.getByRole("group", { name: "Suggestion: Good but high cost" });
  await expect(sug).toContainText("Rejected for Cost: asked 4.2 vs 3.0 LPA (+40%) · avg 4.3 ≥ 3.5");
  await sug.getByRole("button", { name: "Accept" }).click();
  await expect(card.getByRole("list", { name: "Tags" })).toContainText("Good but high cost");
  await expect(card.getByText("accepted suggestion")).toBeVisible();
  await expect(card.getByRole("group", { name: "Suggestion: Good but high cost" })).toHaveCount(0);
  await shoot(h, "profile-summary-rejected-for-cost", { width: 1366, height: 768 });
});

test("B: near-miss for a last-round seat-filled rejection; dismiss stays dismissed until a new decision", async () => {
  const h = pages.hr;
  await h.goto("/dashboard/suggestions");
  const row = h.getByRole("group", { name: `Suggestion: Near-miss (silver medal) for ${people.P2.name}` });
  await expect(row).toContainText("Rejected for Seat filled / better candidate chosen (not a skill reason) · reached the last round (Manager round)");
  await expect(h.getByRole("group", { name: new RegExp(`for ${people.P3.name}`) })).toHaveCount(0); // skill rejection: nothing
  await shoot(h, "suggestions-page", { width: 1366, height: 768 });
  await row.getByLabel("Note (optional)").fill("Not this month");
  await row.getByRole("button", { name: "Dismiss" }).click();
  await expect(h.getByRole("group", { name: `Suggestion: Near-miss (silver medal) for ${people.P2.name}` })).toHaveCount(0);
  await h.reload();
  await expect(h.getByRole("group", { name: `Suggestion: Near-miss (silver medal) for ${people.P2.name}` })).toHaveCount(0);

  // a new decision (manager decides again) brings it back
  const m = pages.mgr;
  await m.goto(`/dashboard/candidates/${people.P2.id}`);
  await m.getByText("Manager override").click();
  await m.getByLabel("Set outcome").selectOption("rejected");
  await m.getByLabel("Reject reason").selectOption("Position filled / better candidate chosen");
  await m.getByLabel("Reason", { exact: true }).last().fill("Decided again after the second panel");
  await m.getByRole("button", { name: "Change outcome" }).click();
  await expect(m.getByText("Outcome changed.")).toBeVisible();
  await h.reload();
  await expect(h.getByRole("group", { name: `Suggestion: Near-miss (silver medal) for ${people.P2.name}` })).toBeVisible();
});

test("B: Do not rehire → red HR-only warning at intake lookup; the consent screen stays clean", async () => {
  const h = pages.hr;
  await h.goto(`/dashboard/candidates/${people.P3.id}`);
  const card = h.getByTestId("summary-card");
  await card.getByLabel("Add a tag").selectOption({ label: "Do not rehire" });
  await card.getByLabel("Reason (required)").fill("Abusive to staff at the last drive");
  await card.getByRole("button", { name: "Add tag" }).click();
  await expect(card.getByRole("list", { name: "Tags" })).toContainText("Do not rehire");
  await shoot(h, "profile-summary-do-not-rehire", { width: 1366, height: 768 });

  await h.goto("/intake");
  await h.getByRole("textbox", { name: "Mobile number" }).fill(people.P3.mobile);
  await h.getByRole("button", { name: "Find" }).click();
  const warn = h.getByTestId("dnr-warning");
  await expect(warn).toContainText("Do not rehire (HR only)");
  await expect(warn).toContainText(`Abusive to staff at the last drive · by ${who.hr.name}`);
  await h.getByRole("button", { name: "Continue with this candidate →" }).click();
  await h.getByRole("radio", { name: "RD AR Caller", exact: true }).click();
  await h.getByLabel("Education").selectOption("B.Com");
  await h.getByLabel("Notice period").selectOption({ label: "30 days" });
  await h.getByLabel("How did they hear about us?").selectOption("Employee referral");
  await expect(h.getByTestId("more-details")).toBeVisible(); // optional, collapsed
  await shoot(h, "intake-more-details", { width: 1366, height: 768 });
  await h.getByRole("button", { name: /Next: consent/ }).click();
  await h.getByRole("button", { name: "The candidate can see the screen" }).click();
  await expect(h.getByRole("checkbox", { name: /I have read this notice/ })).toBeVisible();
  const consentText = await h.locator("body").innerText();
  for (const hidden of ["Do not rehire", "Abusive", "HR only", "Cooldown"]) expect(consentText).not.toContain(hidden);
});

/** Adds another visit to a person (days ago, outcome, category, scorecards). */
async function extraVisit(key: string, o: { daysAgo: number; outcome: string; reason?: string | null; category?: string | null; stageName: string; cards: [string, Record<string, number>][]; token: string }) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(daysAgo(o.daysAgo));
  const [a] = await sql`insert into applications (tenant_id, candidate_id, job_id, location_id, token, token_date, current_stage_id, outcome, reject_reason, reject_category, client_request_id, created_at, decided_at, purge_after, photo_purge_after)
    values (${tenantId}, ${people[key].id}, ${jobId}, ${stage.loc}, ${o.token}, ${day}, ${stage[o.stageName]}, ${o.outcome}, ${o.reason ?? null}, ${o.category ?? null}, ${crypto.randomUUID()}, ${daysAgo(o.daysAgo)}, ${daysAgo(o.daysAgo)},
      ${new Date(Date.now() + 300 * 864e5)}, ${new Date(Date.now() + 120 * 864e5)}) returning id`;
  for (const [st, scores] of o.cards) {
    await sql`insert into scorecards (tenant_id, application_id, stage_id, interviewer_id, scores, overall, decision, updated_at) values (${tenantId}, ${a.id}, ${stage[st]}, ${who.iv.id}, ${sql.json(scores)}, 3, 'reject', ${daysAgo(o.daysAgo)})`;
  }
}

test("C: quick-look finds a typo'd name, 4 mobile digits, tells same names apart, works by keyboard only", async () => {
  await person("K1", { name: "Kavita Sharma", outcome: "rejected", reason: "No relevant RCM experience", category: "knowledge", stageName: "HR screen", cards: [["HR screen", { Communication: 3, Knowledge: 3 }]], city: "Mohali" });
  await person("K2", { name: "Kavita Sharma", outcome: "rejected", reason: "No relevant RCM experience", category: "knowledge", stageName: "HR screen", cards: [], city: "Zirakpur" });
  const h = pages.hr;
  await h.goto("/dashboard");
  await h.locator("body").press("/"); // "/" focuses the box
  const box = h.getByRole("combobox", { name: "Quick look: name or mobile" });
  await expect(box).toBeFocused();
  await h.keyboard.type("Kavta Sharma"); // typo: missing "i"
  const list = h.getByRole("listbox", { name: "Quick look results" });
  await expect(list.getByRole("option")).toHaveCount(2);
  await expect(list.getByRole("option", { name: new RegExp(`${people.K1.mobile} · Mohali`) })).toBeVisible();
  await expect(list.getByRole("option", { name: new RegExp(`${people.K2.mobile} · Zirakpur`) })).toBeVisible();
  await shoot(h, "quick-look-open", { width: 1366, height: 768 });
  await h.keyboard.press("ArrowDown");
  await expect(box).toHaveAttribute("aria-activedescendant", /opt-1$/);
  await h.keyboard.press("Escape");
  await expect(list).toHaveCount(0);

  await box.fill(people.P2.mobile.slice(-4));
  await expect(list.getByRole("option", { name: new RegExp(people.P2.name) })).toBeVisible();
  await box.press("ArrowUp"); // first row
  await box.press("Enter");
  await expect(h).toHaveURL(new RegExp(`/dashboard/candidates/${people.P2.id}$`));
  await expect(h.getByRole("heading", { name: people.P2.name })).toBeVisible();
});

test("C: returning candidate's card: 3 visits, score change, latest line; interviewer has no quick-look", async () => {
  await person("R3", { name: `Rohit Thrice ${run}`, outcome: "rejected", reason: "Salary expectation above budget", category: "cost", stageName: "HR screen", cards: [["HR screen", { Communication: 4, Knowledge: 3.8 }]], token: "R-90" });
  await extraVisit("R3", { daysAgo: 60, outcome: "rejected", reason: "No relevant RCM experience", category: "knowledge", stageName: "HR screen", cards: [["HR screen", { Communication: 3, Knowledge: 2.6 }]], token: "R-91" });
  await extraVisit("R3", { daysAgo: 30, outcome: "no_show", category: "no_show", stageName: "Registered", cards: [], token: "R-92" });
  const h = pages.hr;
  await h.goto(`/dashboard/candidates/${people.R3.id}`);
  const card = h.getByTestId("summary-card");
  await expect(card).toContainText("3 visits");
  await expect(card.getByTestId("score-change")).toHaveText("↑ 2.8 → 3.9, +1.1");
  await expect(card.getByTestId("summary-line")).toHaveText("Not hired — Cost / salary expectation: no figures recorded · reached HR screen · avg 3.9/5 · 3 visits");
  await expect(card.getByRole("list", { name: "Visits at a glance" }).getByRole("listitem")).toHaveCount(3);
  await expect(card.getByTestId("summary-keep")).toContainText("Data deletes on");
  await shoot(h, "profile-summary-returning", { width: 1366, height: 768 });

  const iv = pages.iv;
  await iv.goto("/interview");
  await expect(iv.locator("header")).toBeVisible();
  await expect(iv.getByRole("combobox", { name: "Quick look: name or mobile" })).toHaveCount(0);
  expect((await iv.request.get(`/api/quicklook?q=${encodeURIComponent("Rohit")}`)).status()).toBe(403);
});

test("D: contact twice → cooling warning; call-back set → due after a clock shift → snooze → done; Do not contact hides", async () => {
  const h = pages.hr;
  await h.goto(`/dashboard/candidates/${people.P2.id}`);
  const box = h.getByRole("region", { name: /Contact and call-backs/ });
  const contact = box.getByRole("group", { name: "Contact" });
  await contact.getByRole("button", { name: "Mark contacted" }).click();
  await contact.getByLabel("Outcome").selectOption("call_later");
  await contact.getByRole("button", { name: "Save contact" }).click();
  await expect(box.getByRole("list", { name: "Contact log" })).toContainText("Call later");
  await expect(contact.getByTestId("cooling")).toHaveText(`Contacted today by ${who.hr.name} — contact again?`);
  // second contact inside the cooling period: the warning asks first; Cancel = nothing happens
  await contact.getByRole("button", { name: "WhatsApp" }).click();
  await expect(contact.getByTestId("wa-preview")).toContainText(`Hello ${people.P2.name}`);
  const asked: string[] = [];
  h.once("dialog", (d) => {
    asked.push(d.message());
    void d.dismiss();
  });
  await contact.getByRole("link", { name: "Open WhatsApp" }).click();
  expect(asked[0]).toContain("Contacted today by");
  await expect(contact.getByRole("form", { name: "Log the contact" })).toHaveCount(0);
  await shoot(h, "profile-contact-callbacks", { width: 1366, height: 768 });

  // call-back with the default date, then the clock moves past it
  await box.getByRole("button", { name: "Set call-back" }).click();
  await expect(box.getByText(/Call-back on/)).toBeVisible();
  await sql`update callbacks set due_on = ${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(daysAgo(2))} where candidate_id = ${people.P2.id}`;
  await h.goto("/dashboard/callbacks");
  const item = h.getByRole("listitem", { name: `Call-back: ${people.P2.name}` });
  await expect(item).toContainText("Overdue since");
  await shoot(h, "callbacks-page", { width: 1366, height: 768 });
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + 864e5));
  await item.getByRole("button", { name: "Snooze" }).click();
  await item.getByLabel("Snooze to").fill(tomorrow);
  await item.getByRole("button", { name: "Snooze", exact: true }).last().click();
  await expect(h.getByRole("region", { name: /Due now/ }).getByRole("listitem", { name: `Call-back: ${people.P2.name}` })).toHaveCount(0);
  await expect(h.getByText("Due now (0)")).toBeVisible();
  await sql`update callbacks set due_on = ${today} where candidate_id = ${people.P2.id}`;
  await h.reload();
  const again = h.getByRole("listitem", { name: `Call-back: ${people.P2.name}` });
  await again.getByRole("button", { name: "Done" }).click();
  await again.getByLabel("Outcome").selectOption("interested");
  await again.getByRole("button", { name: "Save" }).click();
  await expect(h.getByText("Due now (0)")).toBeVisible();
  const [cb] = await sql`select status, outcome from callbacks where candidate_id = ${people.P2.id}`;
  expect(cb).toEqual({ status: "done", outcome: "interested" });

  // Do not contact: a due call-back disappears and the profile has no contact buttons
  await sql`insert into callbacks (tenant_id, candidate_id, due_on) values (${tenantId}, ${people.R3.id}, ${today})`;
  await h.reload();
  await expect(h.getByRole("listitem", { name: `Call-back: ${people.R3.name}` })).toBeVisible();
  await h.goto(`/dashboard/candidates/${people.R3.id}`);
  await h.getByText("They asked not to be contacted…").click();
  await h.getByLabel("What did they say?").fill("Please do not call me again");
  await h.getByRole("button", { name: "Mark Do not contact" }).click();
  await expect(h.getByTestId("dnc")).toContainText("Please do not call me again");
  await expect(h.getByRole("group", { name: "Contact" })).toHaveCount(0);
  await h.goto("/dashboard/callbacks");
  await expect(h.getByRole("listitem", { name: `Call-back: ${people.R3.name}` })).toHaveCount(0);
});

async function download(page: Page, click: () => Promise<void>) {
  const [d] = await Promise.all([page.waitForEvent("download"), click()]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync((await d.path())!) as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets[0];
  const rows: string[][] = [];
  ws.eachRow((r) => rows.push((r.values as unknown[]).slice(1).map((v) => String(v ?? ""))));
  return { name: d.suggestedFilename(), rows };
}

test("E: tagged cost rejection is in the pool and in a bulk list above the ask, not below; Do not contact hidden; push + exports", async () => {
  await sql`insert into candidate_tags (tenant_id, candidate_id, tag_code, source, note) values (${tenantId}, ${people.R3.id}, 'reconsider', 'manual', 'seed')`;
  const h = pages.hr;
  await h.goto("/dashboard/pool");
  const pool = h.getByRole("list", { name: "Pool" });
  await expect(pool.getByRole("listitem", { name: `Pool: ${people.P1.name}` })).toContainText("Good but high cost");
  await expect(pool.getByRole("listitem", { name: `Pool: ${people.R3.name}` })).toHaveCount(0); // do not contact
  await shoot(h, "pool-page", { width: 1366, height: 768 });
  await h.goto("/dashboard/pool?dnc=yes");
  await expect(h.getByRole("listitem", { name: `Pool: ${people.R3.name}` })).toContainText("Do not contact");
  const poolX = await download(h, () => h.goto("/dashboard/pool").then(() => h.getByRole("link", { name: "Export to Excel" }).click()));
  expect(poolX.rows[0]).toEqual(["Name", "Mobile", "City", "Education", "Experience", "Expected CTC (LPA)", "Avg score (of 5)", "Score change", "Last visit", "Tags", "Talent-pool consent", "Summary"]);
  expect(poolX.rows.some((r) => r[0] === people.P1.name && r[9].includes("Good but high cost"))).toBe(true);
  expect(poolX.rows.some((r) => r[0] === people.R3.name)).toBe(false);

  const list = (p: Page) => p.getByRole("list", { name: "Ranked list" });
  await h.goto("/dashboard/bulk?needed=10&budget=4.5&night=yes");
  await expect(list(h).getByRole("listitem", { name: new RegExp(people.P1.name) })).toContainText("Cost reject · asked 4.2 ≤ budget 4.5");
  await expect(list(h).getByRole("listitem", { name: new RegExp(people.R3.name) })).toHaveCount(0);
  await expect(h.getByTestId("exclusions")).toContainText(/Do not contact: [1-9]/);
  await shoot(h, "bulk-page", { width: 1366, height: 768 });
  await h.goto("/dashboard/bulk?needed=10&budget=4");
  await expect(list(h).getByRole("listitem", { name: new RegExp(people.P1.name) })).toContainText("+5% over budget (asked 4.2)");
  await h.goto("/dashboard/bulk?needed=10&budget=3");
  await expect(h.getByRole("listitem", { name: new RegExp(people.P1.name) })).toHaveCount(0);
  await expect(h.getByTestId("exclusions")).toContainText(/Too far over budget: [1-9]/);

  // save as a push, then work it
  await h.goto("/dashboard/bulk?needed=10&budget=4.5&night=yes");
  const bulkX = await download(h, () => h.getByRole("link", { name: "Export to Excel" }).click());
  expect(bulkX.rows[0]).toEqual(["Rank", "Score (0-100)", "Name", "Mobile", "City", "Expected CTC (LPA)", "Avg score (of 5)", "Last visit", "Why on the list"]);
  expect(bulkX.rows.some((r) => r[2] === people.P1.name && r[8].startsWith("Cost reject"))).toBe(true);
  await h.getByLabel(/Save this list as a hiring push/).fill(`AR callers ${run}`);
  await h.getByRole("button", { name: "Save push" }).click();
  await expect(h.getByRole("heading", { name: `AR callers ${run}` })).toBeVisible();
  const item = h.getByRole("listitem", { name: `Push: ${people.P1.name}` });
  await item.getByLabel(`Status of ${people.P1.name}`).selectOption("interested");
  await expect(h.getByTestId("push-progress")).toContainText("Interested 1");
  await expect(h.getByTestId("push-progress")).toContainText("Called 1");
  await item.getByLabel(`Status of ${people.P1.name}`).selectOption("booked");
  await expect(h.getByTestId("push-progress")).toContainText("Booked for interview 1");
  await shoot(h, "push-page", { width: 1366, height: 768 });
  const pushX = await download(h, () => h.getByRole("link", { name: "Export to Excel" }).click());
  expect(pushX.rows[0]).toEqual(["Rank", "Name", "Mobile", "City", "Status", "Score (0-100)", "Why on the list"]);
  expect(pushX.rows.find((r) => r[1] === people.P1.name)?.[4]).toBe("Booked for interview");
  const audits = await sql`select action, meta from audit_log where tenant_id = ${tenantId} and action in ('push.create', 'push.status', 'export.download')`;
  expect(audits.filter((a) => a.action === "push.status")).toHaveLength(2);
  expect(JSON.stringify(audits)).not.toContain(people.P1.name);

  // the same person in a second list: warned
  await h.goto("/dashboard/bulk?needed=10&budget=4.5&night=yes");
  await expect(list(h).getByRole("listitem", { name: new RegExp(people.P1.name) })).toContainText(`already in push AR callers ${run}`);
});

test("F: offer with another offer in hand + long notice → two risk hints (profile, joining soon, drive board); reports show real figures", async () => {
  await person("S1", { name: `Sunil Selected ${run}`, outcome: "selected", stageName: "Offer", cards: [["HR screen", { Communication: 4, Knowledge: 4 }]], token: "R-80" });
  await sql`update candidates set notice_days = 90 where id = ${people.S1.id}`;
  const h = pages.hr;
  await h.goto(`/dashboard/candidates/${people.S1.id}`);
  await h.getByText("Add another offer").click();
  const oo = h.getByRole("form", { name: "Add another offer" });
  await oo.getByLabel("Company").fill("Acme RCM");
  await oo.getByLabel("Offered CTC (LPA)").fill("4");
  await oo.getByRole("button", { name: "Add other offer" }).click();
  await expect(h.getByText("Other offer saved.")).toBeVisible();
  const box = h.getByRole("region", { name: "Offer and joining" });
  await box.getByLabel("Offer status").selectOption("accepted");
  await box.getByLabel("Offered CTC (LPA)").fill("3.5");
  await box.getByLabel("Joining date").fill(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + 10 * 864e5)));
  await box.getByRole("button", { name: "Save offer" }).click();
  await expect(box.getByText("Offer saved.")).toBeVisible();
  const hints = h.getByTestId("summary-card").getByTestId("risk-hints");
  await expect(hints.getByRole("listitem")).toHaveCount(2);
  await expect(hints).toContainText("Other offer in hand: Acme RCM, 4 LPA");
  await expect(hints).toContainText("Notice period 90 days (60 or more)");
  await shoot(h, "profile-summary-risk-hints", { width: 1366, height: 768 });
  const [a] = await sql`select risk_hints from applications where id = ${people.S1.appId}`;
  expect(a.risk_hints).toEqual(["other_offer", "notice"]); // saved with the offer for the report

  await h.goto("/dashboard/joining");
  await expect(h.getByRole("listitem", { name: `Joining: ${people.S1.name}` }).getByTestId("risk-hints")).toContainText("Notice period 90 days");
  await shoot(h, "joining-soon", { width: 1366, height: 768 });
  await h.goto("/dashboard/drive"); // creates today's drive
  await sql`update applications set drive_id = (select id from drives where tenant_id = ${tenantId} order by created_at desc limit 1) where id = ${people.S1.appId}`;
  await h.reload();
  await expect(h.getByTestId("drive-risk")).toContainText("Joining-risk hints: Other offer in hand");

  // the person turns the offer down → the report pairs the hints with "dropped"
  await sql`update applications set outcome = 'offer_declined', offer_status = 'declined' where id = ${people.S1.appId}`;
  await h.goto("/dashboard/reports");
  const rep = h.getByLabel("Rediscovery reports");
  await expect(rep.getByRole("table", { name: "Why we didn't hire", exact: true })).toContainText("Cost / salary expectation");
  await expect(rep.getByTestId("cost-gap")).toContainText("Cost decisions");
  await expect(rep.getByTestId("push-funnel")).toContainText("booked 1");
  await expect(rep.getByRole("table", { name: "Joining-risk hints vs outcome" }).getByRole("row", { name: /Other offer in hand/ })).toContainText("1");
  await expect(rep.getByRole("table", { name: "Suggestions accepted vs dismissed" })).toContainText("Good but high cost");
  await expect(rep.getByTestId("callbacks-report")).toContainText("done in the period: 1");
  await shoot(h, "reports-rediscovery", { width: 1366, height: 768 });
});

test("UI: Settings → Rediscovery and Lists (admin), Summary card for a new and a hired candidate", async ({ browser }) => {
  const admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  try {
    await signIn(admin, who.admin);
    await admin.goto("/dashboard/settings/rediscovery");
    await expect(admin.getByRole("heading", { name: "Rediscovery", exact: true })).toBeVisible();
    await expect(admin.getByText("Sample — confirm").first()).toBeVisible();
    await expect(admin.getByLabel("Strong score (of 5)")).toHaveValue("3.5");
    await shoot(admin, "settings-rediscovery", { width: 1440, height: 900 });
    await admin.goto("/dashboard/settings/lists");
    await expect(admin.getByRole("heading", { name: "Reject categories" })).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Rediscovery tags" })).toBeVisible();
    await shoot(admin, "settings-lists", { width: 1440, height: 900 });
  } finally {
    await admin.context().close();
  }
  await person("N1", { name: `Neha New ${run}`, outcome: "in_progress", stageName: "Registered", cards: [], token: "R-70" });
  const h = pages.hr;
  await h.goto(`/dashboard/candidates/${people.N1.id}`);
  await expect(h.getByTestId("summary-line")).toHaveText("In progress — Registered");
  await shoot(h, "profile-summary-new", { width: 1366, height: 768 });
  await sql`update applications set outcome = 'joined', joined_on = ${today}, offer_status = 'accepted', purge_after = null, photo_purge_after = null where id = ${people.S1.appId}`;
  await h.goto(`/dashboard/candidates/${people.S1.id}`);
  await expect(h.getByTestId("summary-line")).toContainText("Hired — joined");
  await expect(h.getByTestId("summary-keep")).toHaveText("Kept (employee record)");
  await shoot(h, "profile-summary-hired", { width: 1366, height: 768 });
});
