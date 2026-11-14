import { createHmac } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import postgres from "postgres";
import { paceSignIn, signIn, submitSignIn } from "./helpers";

// Phase 5 (internet-facing): two-factor sign-in, lockout, office IP allow-list, security headers and cookies,
// session revocation, API rate limit. Throwaway tenant; every row made here is removed afterwards.
const run = Date.now().toString(36);
const sql = postgres(process.env.DATABASE_URL!);
type Who = { id: string; email: string; password: string; name: string };
const who = {} as Record<"admin" | "admin2" | "hr" | "tv", Who>;
let tenantId = "";
// E2E_BEHIND_PROXY=1: the run goes through Caddy (Caddyfile.aws), which replaces any X-Forwarded-For a client sends.
const behindProxy = process.env.E2E_BEHIND_PROXY === "1";

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) from a base32 secret: what an authenticator app shows. */
function totp(secret: string, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

const ctx = async (browser: Browser, ip?: string) => browser.newContext({ viewport: { width: 1366, height: 768 }, extraHTTPHeaders: ip ? { "x-forwarded-for": ip } : {} });

/** The page's own message (not Next.js's route announcer, which is also role=alert). */
const alert = (page: Page) => page.locator('[role=alert]:not(#__next-route-announcer__)');

async function signInTyped(page: Page, w: Who, password = w.password) {
  await paceSignIn();
  await page.goto("/login");
  await page.getByLabel("Email").fill(w.email);
  await page.getByLabel("Password").fill(password);
  await submitSignIn(page);
}

test.beforeAll(async () => {
  const [t] = await sql`insert into tenants (name, slug, token_prefix, profile_sample) values ('E2E Security Co', ${`e2e-sec-${run}`}, 'S', false) returning id`;
  tenantId = t.id;
  await sql`insert into locations (tenant_id, name) values (${tenantId}, 'SEC office')`;
  await sql`insert into stages (tenant_id, name, position, is_interview) values (${tenantId}, 'Registered', 1, false), (${tenantId}, 'HR screen', 2, true)`;
  for (const [key, role] of [["admin", "admin"], ["admin2", "admin"], ["hr", "hr"], ["tv", "display"]] as const) {
    const id = crypto.randomUUID();
    const w = { id, email: `${key}-${run}@e2e-sec.example.test`, password: `Pw-${crypto.randomUUID().slice(0, 12)}`, name: `SEC ${key}` };
    await sql`insert into users (id, name, email, role, tenant_id) values (${id}, ${w.name}, ${w.email}, ${role}, ${tenantId})`;
    await sql`insert into accounts (id, account_id, provider_id, user_id, password) values (${crypto.randomUUID()}, ${id}, 'credential', ${id}, ${await hashPassword(w.password)})`;
    who[key] = w;
  }
});

test.afterAll(async () => {
  const t = [tenantId];
  for (const q of ["panels", "drives", "daily_counters", "audit_log", "option_items", "privacy_notices", "tenant_settings", "users", "stages", "locations"]) await sql`delete from ${sql(q)} where tenant_id in ${sql(t)}`;
  await sql`delete from tenants where id = ${tenantId}`;
  await sql.end();
});

test("two-factor: enrol with an authenticator, sign in with a code, then with a recovery code (once), admin reset", async ({ browser }) => {
  const c = await ctx(browser);
  const p = await c.newPage();
  await signIn(p, who.hr);
  await p.goto("/account/security");
  await p.getByLabel("Your password").fill(who.hr.password);
  await p.getByRole("button", { name: "Set up two-factor sign-in" }).click();
  await expect(p.getByAltText("QR code for the authenticator app")).toBeVisible();
  const secret = (await p.getByTestId("totp-secret").textContent())!.trim();
  await p.getByLabel(/The 6-digit code/).fill("000000");
  await p.getByRole("button", { name: "Turn on" }).click();
  await expect(alert(p)).toContainText("That code is not right");
  await p.getByLabel(/The 6-digit code/).fill(totp(secret));
  await p.getByRole("button", { name: "Turn on" }).click();
  await expect(p.getByTestId("recovery-codes").locator("li")).toHaveCount(10);
  const codes = (await p.getByTestId("recovery-codes").locator("li").allTextContents()).map((s) => s.trim());
  expect(codes).toHaveLength(10);
  const [u] = await sql`select two_factor_enabled from users where id = ${who.hr.id}`;
  expect(u.two_factor_enabled).toBe(true);
  const [secretRow] = await sql`select secret, backup_codes from two_factors where user_id = ${who.hr.id}`;
  expect(secretRow.secret).not.toContain(secret); // stored encrypted, not as the plain key
  expect(secretRow.backup_codes).not.toContain(codes[0]);
  await c.close();

  // sign in: password, then the app's code
  const c2 = await ctx(browser);
  const p2 = await c2.newPage();
  await signInTyped(p2, who.hr);
  await expect(p2.getByLabel("6-digit code from your authenticator app")).toBeVisible();
  expect(await p2.request.get("/api/quicklook?q=ab").then((r) => r.status())).toBe(401); // no session before the code
  await p2.getByLabel("6-digit code from your authenticator app").fill(totp(secret));
  await p2.getByRole("button", { name: "Verify" }).click();
  await expect(p2.locator("header")).toBeVisible();
  await c2.close();

  // lost phone: a recovery code works once
  for (const [i, expectOk] of [[0, true], [1, false]] as const) {
    const c3 = await ctx(browser);
    const p3 = await c3.newPage();
    await signInTyped(p3, who.hr);
    await p3.getByRole("button", { name: /Use a recovery code/ }).click();
    await p3.getByLabel("Recovery code").fill(codes[0]);
    await p3.getByRole("button", { name: "Verify" }).click();
    if (expectOk) await expect(p3.locator("header")).toBeVisible();
    else await expect(alert(p3)).toContainText("not right or was already used");
    void i;
    await c3.close();
  }

  // admin resets it (lost phone, no recovery codes): HR signs in with the password only
  const a = await ctx(browser);
  const pa = await a.newPage();
  await signIn(pa, who.admin);
  await pa.goto("/dashboard/users");
  const row = pa.getByRole("row").filter({ hasText: who.hr.email });
  await expect(row).toContainText("Two-factor on");
  pa.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "Reset two-factor" }).click();
  await expect(row).toContainText("Two-factor off");
  const audit = await sql`select action, meta from audit_log where tenant_id = ${tenantId} and entity_id = ${who.hr.id} and action = 'user.two_factor_reset'`;
  expect(audit).toHaveLength(1);
  await a.close();
  const c4 = await ctx(browser);
  const p4 = await c4.newPage();
  await signIn(p4, who.hr);
  await expect(p4.locator("header")).toBeVisible();
  await c4.close();
});

test("lockout: 5 wrong passwords lock the account (audited); even the right password waits; admin unlocks", async ({ browser }) => {
  const c = await ctx(browser);
  const p = await c.newPage();
  for (let i = 0; i < 5; i++) {
    await signInTyped(p, who.admin2, "wrong-password");
    await expect(alert(p)).toContainText(i < 4 ? "Wrong email or password" : /Wrong email or password|locked/);
  }
  await signInTyped(p, who.admin2);
  await expect(alert(p)).toContainText(/This account is locked for \d+ more minutes/);
  const rows = await sql`select action, meta from audit_log where tenant_id = ${tenantId} and entity_id = ${who.admin2.id} and action in ('auth.sign_in_failed', 'auth.lockout') order by id`;
  expect(rows.filter((r) => r.action === "auth.sign_in_failed")).toHaveLength(5);
  expect(rows.find((r) => r.action === "auth.lockout")?.meta).toMatchObject({ attempts: 5 });
  expect(JSON.stringify(rows)).not.toContain(who.admin2.email);

  const a = await ctx(browser);
  const pa = await a.newPage();
  await signIn(pa, who.admin);
  await pa.goto("/dashboard/users");
  const row = pa.getByRole("row").filter({ hasText: who.admin2.email });
  await expect(row).toContainText("Locked (wrong passwords)");
  await row.getByRole("button", { name: "Unlock" }).click();
  await expect(row).not.toContainText("Locked");
  await a.close();
  await signIn(p, who.admin2);
  await expect(p.locator("header")).toBeVisible();
  await c.close();
});

test("office IP allow-list: off by default; on → sign-in only from listed addresses, TV only from them; off again", async ({ browser }) => {
  test.skip(behindProxy, "fakes addresses with X-Forwarded-For, which the proxy (rightly) replaces");
  const OFFICE = "203.0.113.25";
  const HOME = "198.51.100.77";
  const office = await ctx(browser, OFFICE);
  const pa = await office.newPage();
  await signIn(pa, who.admin);
  await pa.goto("/dashboard/settings/security");
  await expect(pa.getByTestId("my-ip")).toHaveText(OFFICE);
  await pa.getByLabel("Allow sign-in only from the addresses below").check();
  await pa.getByLabel(/Addresses \(one per line/).fill("192.0.2.0/24");
  await pa.getByRole("button", { name: "Save" }).click();
  await expect(alert(pa)).toContainText(`Your own address (${OFFICE}) is not on the list`); // no self-lockout
  await pa.getByRole("button", { name: `Add my address (${OFFICE})` }).click();
  await pa.getByRole("button", { name: "Save" }).click();
  await expect(pa.getByRole("status")).toContainText("Saved: sign-in only from these addresses.");

  const home = await ctx(browser, HOME);
  const ph = await home.newPage();
  await signInTyped(ph, who.hr);
  await expect(alert(ph)).toContainText("Sign-in is allowed only from the office network");
  const blocked = await sql`select count(*)::int as n from audit_log where tenant_id = ${tenantId} and action = 'auth.ip_blocked'`;
  expect(blocked[0].n).toBeGreaterThan(0);
  // the TV: signs in at the office, then the same session from home is refused
  const tvOffice = await ctx(browser, OFFICE);
  const ptv = await tvOffice.newPage();
  await signIn(ptv, who.tv);
  await expect(ptv).toHaveURL(/\/tv$/);
  const cookies = await tvOffice.cookies();
  const tvHome = await ctx(browser, HOME);
  await tvHome.addCookies(cookies);
  const ptv2 = await tvHome.newPage();
  await ptv2.goto("/tv");
  await expect(ptv2).toHaveURL(/\/not-allowed$/);
  await expect(ptv2.getByRole("heading", { name: "Not allowed from this network" })).toBeVisible();

  // off again: everyone, from anywhere
  await pa.getByLabel("Allow sign-in only from the addresses below").uncheck();
  await pa.getByRole("button", { name: "Save" }).click();
  await expect(pa.getByRole("status")).toContainText("the list is off");
  await signIn(ph, who.hr);
  await expect(ph.locator("header")).toBeVisible();
  for (const c of [office, home, tvOffice, tvHome]) await c.close();
});

test("security headers on pages and APIs; cookies HttpOnly + SameSite (Secure behind HTTPS)", async ({ browser, baseURL }) => {
  const c = await ctx(browser);
  const p = await c.newPage();
  const res = await p.goto("/login");
  const h = res!.headers();
  expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["referrer-policy"]).toBe("same-origin");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["permissions-policy"]).toContain("camera=(self)");
  if (baseURL!.startsWith("https://")) expect(h["strict-transport-security"]).toContain("max-age=31536000");
  // the nonce is fresh per request and Next.js uses it on its scripts (the page works)
  const again = (await (await p.request.get("/login")).headers())["content-security-policy"];
  expect(again).not.toBe(h["content-security-policy"]);
  const errors: string[] = [];
  p.on("console", (m) => m.type() === "error" && /Content Security Policy/i.test(m.text()) && errors.push(m.text()));
  await signIn(p, who.admin);
  await p.goto("/dashboard");
  await p.goto("/dashboard/settings/company");
  expect(errors).toEqual([]);
  const api = (await p.request.get("/api/health")).headers();
  expect(api["x-content-type-options"]).toBe("nosniff");
  expect(api["content-security-policy"]).toBeUndefined(); // API responses set their own
  const session = (await c.cookies()).find((k) => /session_token/.test(k.name))!;
  expect(session.httpOnly).toBe(true);
  expect(session.sameSite).toBe("Lax");
  expect(session.secure).toBe(baseURL!.startsWith("https://"));
  await c.close();
});

test("sessions: a copied cookie stops working after sign-out; password change and 'sign out everywhere' end other sessions", async ({ browser }) => {
  const a = await ctx(browser);
  const pa = await a.newPage();
  await signIn(pa, who.admin);
  const stolen = await a.cookies();
  const thief = await ctx(browser);
  await thief.addCookies(stolen);
  expect((await thief.request.get("/api/quicklook?q=ab")).status()).toBe(200); // works while signed in
  await pa.getByRole("button", { name: /account menu/ }).click();
  await pa.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(pa).toHaveURL(/\/login$/);
  expect((await thief.request.get("/api/quicklook?q=ab")).status()).toBe(401); // the copy is dead

  // two PCs; "sign out everywhere" on one ends both
  const pc1 = await ctx(browser);
  const pc2 = await ctx(browser);
  const p1 = await pc1.newPage();
  const p2 = await pc2.newPage();
  await signIn(p1, who.admin);
  await signIn(p2, who.admin);
  await p1.goto("/account/security");
  p1.once("dialog", (d) => d.accept());
  await p1.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(p1).toHaveURL(/\/login$/);
  await p2.goto("/dashboard");
  await expect(p2).toHaveURL(/\/login$/);

  // a password change on one PC signs the other PC out
  const pc3 = await ctx(browser);
  const pc4 = await ctx(browser);
  const p3 = await pc3.newPage();
  const p4 = await pc4.newPage();
  await signIn(p3, who.admin2);
  await signIn(p4, who.admin2);
  const newPassword = `Pw-${crypto.randomUUID().slice(0, 12)}`;
  await p3.goto("/account/password");
  await p3.getByLabel("Current password").fill(who.admin2.password);
  await p3.getByLabel("New password", { exact: true }).fill(newPassword);
  await p3.getByLabel("Repeat new password").fill(newPassword);
  await p3.getByRole("button", { name: "Change password" }).click();
  await expect(p3.getByRole("status")).toContainText("Other devices were signed out");
  who.admin2.password = newPassword;
  await p4.goto("/dashboard");
  await expect(p4).toHaveURL(/\/login$/);
  await p3.goto("/dashboard");
  await expect(p3).not.toHaveURL(/\/login$/); // this PC stays signed in
  for (const c of [a, thief, pc1, pc2, pc3, pc4]) await c.close();
});

test("sign-in limit per address (SIGN_IN_LIMIT): the attempt after the limit gets 429; other addresses are unaffected", async ({ request, baseURL }) => {
  const [max, seconds] = (process.env.SIGN_IN_LIMIT || "20/60").split("/").map(Number);
  if (behindProxy) await new Promise((r) => setTimeout(r, seconds * 1000 + 500)); // every request shares 127.0.0.1's budget: start from an empty window
  const from = (ip: string) => ({ headers: { "x-forwarded-for": ip, origin: baseURL! }, data: { email: `nobody-${run}@e2e-sec.example.test`, password: "wrong-password" } });
  const statuses: number[] = [];
  for (let i = 0; i <= max; i++) statuses.push((await request.post("/api/auth/sign-in/email", from("192.0.2.200"))).status());
  expect(statuses.slice(0, max).every((s) => s === 401)).toBe(true);
  expect(statuses[max]).toBe(429);
  // directly at the app, another address has its own budget; behind the proxy a faked address changes nothing
  expect((await request.post("/api/auth/sign-in/email", from("192.0.2.201"))).status()).toBe(behindProxy ? 429 : 401);
});

test("behind the proxy a client cannot fake its address with X-Forwarded-For", async ({ browser }) => {
  test.skip(!behindProxy, "needs E2E_BEHIND_PROXY=1 (a run through Caddy)");
  const c = await ctx(browser, "203.0.113.25");
  const p = await c.newPage();
  await signIn(p, who.admin);
  await p.goto("/dashboard/settings/security");
  await expect(p.getByTestId("my-ip")).toHaveText(/^(127\.0\.0\.1|::1)$/);
  await c.close();
});

test("API rate limit per signed-in person: 429 after API_RATE_LIMIT_PER_MINUTE requests", async ({ browser }) => {
  test.skip(Number(process.env.API_RATE_LIMIT_PER_MINUTE || 600) > 600, "runs with the default limit");
  const c = await ctx(browser);
  const p = await c.newPage();
  await signIn(p, who.hr);
  const statuses: number[] = [];
  for (let i = 0; i < 610; i++) statuses.push((await p.request.get("/api/quicklook?q=zz")).status());
  expect(statuses.slice(0, 590).every((s) => s === 200)).toBe(true);
  expect(statuses.slice(-5)).toEqual([429, 429, 429, 429, 429]);
  await c.close();
});

test("required two-factor (TWO_FACTOR_REQUIRED_ROLES=admin,hr): HR is sent to set it up; APIs refuse until then", async ({ browser }) => {
  test.skip(process.env.E2E_TWO_FACTOR_REQUIRED !== "admin,hr", "needs a server started with TWO_FACTOR_REQUIRED_ROLES=admin,hr");
  const c: BrowserContext = await ctx(browser);
  const p = await c.newPage();
  await signInTyped(p, who.hr);
  await expect(p).toHaveURL(/\/account\/security$/);
  await expect(p.getByText("Your role must use two-factor sign-in")).toBeVisible();
  await p.goto("/dashboard");
  await expect(p).toHaveURL(/\/account\/security$/);
  const r = await p.request.get("/api/quicklook?q=ab");
  expect(r.status()).toBe(403);
  await c.close();
});
