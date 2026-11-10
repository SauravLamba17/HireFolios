import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

// Test users use this domain and are deleted afterwards.
const TEST_DOMAIN = "e2e.example.test";
const admin = { email: process.env.SEED_ADMIN_EMAIL!, password: process.env.SEED_ADMIN_PASSWORD! };
const hr = {
  name: "E2E HR user",
  email: `hr-${Date.now()}@${TEST_DOMAIN}`,
  password: `E2e-${crypto.randomUUID().slice(0, 12)}`,
};
// Set SHOTS_DIR to save UI screenshots there (keep it outside the repo).
const SHOTS = process.env.SHOTS_DIR;
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1024", width: 1024, height: 768 },
  { name: "800x1280", width: 800, height: 1280 },
];

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  const sql = postgres(process.env.DATABASE_URL!);
  await sql`delete from users where email like ${"%@" + TEST_DOMAIN}`;
  await sql.end();
});

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function shoot(page: Page, name: string) {
  if (!SHOTS) return;
  for (const v of VIEWPORTS) {
    await page.setViewportSize({ width: v.width, height: v.height });
    await page.screenshot({ path: path.join(SHOTS, `${name}-${v.name}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

test("signed-out visitors are sent to /login", async ({ page }) => {
  for (const url of ["/", "/dashboard", "/dashboard/users", "/intake", "/account/password"]) {
    await page.goto(url);
    await expect(page).toHaveURL(/\/login$/);
  }
  const res = await page.request.post("/api/users", { data: {} });
  expect(res.status()).toBe(401);
  await shoot(page, "login");
});

test("admin adds an HR user", async ({ page }) => {
  await signIn(page, admin);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: "Staff", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Staff accounts" })).toBeVisible();

  await page.getByLabel("Full name").fill(hr.name);
  await page.getByLabel("Email").fill(hr.email);
  await page.getByLabel("Role", { exact: true }).selectOption("hr");
  await page.getByLabel("Temporary password").fill(hr.password);
  await page.getByRole("button", { name: "Add staff" }).click();
  await expect(page.getByRole("status")).toContainText(`Added ${hr.name}`);
  await expect(page.getByRole("row").filter({ hasText: hr.email })).toBeVisible();

  await shoot(page, "users");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("HR is blocked from the users page", async ({ page }) => {
  await signIn(page, hr);
  await expect(page).toHaveURL(/\/intake$/);
  await expect(page.getByRole("link", { name: "Staff", exact: true })).toHaveCount(0);

  await page.goto("/dashboard/users");
  await expect(page).toHaveURL(/\/intake$/);
  await expect(page.getByRole("heading", { name: "Staff accounts" })).toHaveCount(0);

  const res = await page.request.post("/api/users", {
    data: { name: "x", email: `x@${TEST_DOMAIN}`, role: "admin", password: "12345678" },
  });
  expect(res.status()).toBe(403);
});
