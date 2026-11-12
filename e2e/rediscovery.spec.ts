import fs from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import postgres from "postgres";
import { shoot, signIn } from "./helpers";

// Phase 3.6 (docs/REDISCOVERY.md): candidate 360 + rediscovery, in a throwaway tenant whose rows are made here.
const run = Date.now().toString(36);
const sql = postgres(process.env.DATABASE_URL!);
const UPLOAD = process.env.UPLOAD_DIR!;
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
  for (const [key, viewport] of [["hr", { width: 1366, height: 768 }], ["mgr", { width: 1440, height: 900 }]] as const) {
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
  fs.rmSync(path.join(UPLOAD, tenantId), { recursive: true, force: true });
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
