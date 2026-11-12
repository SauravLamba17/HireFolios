import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { shoot, signIn } from "./helpers";

// Test users use this domain and are deleted afterwards.
const TEST_DOMAIN = "e2e.example.test";
const admin = { email: process.env.SEED_ADMIN_EMAIL!, password: process.env.SEED_ADMIN_PASSWORD! };
const hr = {
  name: "E2E HR user",
  email: `hr-${Date.now()}@${TEST_DOMAIN}`,
  password: `E2e-${crypto.randomUUID().slice(0, 12)}`,
};
test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  const sql = postgres(process.env.DATABASE_URL!);
  await sql`delete from users where email like ${"%@" + TEST_DOMAIN}`;
  await sql.end();
});

test("signed-out visitors are sent to /login", async ({ page }) => {
  for (const url of ["/", "/dashboard", "/dashboard/users", "/dashboard/settings", "/intake", "/account/password", "/dashboard/candidates/7d1c0f5e-3a55-4a51-9a49-5b8a0d1e2f30"]) {
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
  // Staff lives in the header's Admin menu
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await page.getByRole("menuitem", { name: "Staff", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Staff accounts" })).toBeVisible();

  await page.getByLabel("Full name").fill(hr.name);
  await page.getByLabel("Email").fill(hr.email);
  await page.getByLabel("Role", { exact: true }).selectOption("hr");
  await page.getByLabel("Temporary password").fill(hr.password);
  await page.getByRole("button", { name: "Add staff" }).click();
  await expect(page.getByRole("status")).toContainText(`Added ${hr.name}`);
  await expect(page.getByRole("row").filter({ hasText: hr.email })).toBeVisible();

  await shoot(page, "users");
  await page.getByRole("button", { name: /account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("HR is blocked from the users page", async ({ page }) => {
  await signIn(page, hr);
  // Temporary password from the admin: change it first (see intake.spec.ts for the full rule).
  await expect(page).toHaveURL(/\/account\/password$/);
  await page.getByLabel("Temporary password").fill(hr.password);
  await page.getByLabel("New password", { exact: true }).fill(`${hr.password}-new`);
  await page.getByLabel("Repeat new password").fill(`${hr.password}-new`);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page).toHaveURL(/\/intake$/);
  // HR gets a "More" menu without Staff, and no Admin menu at all
  await expect(page.getByRole("button", { name: "Admin", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Reports" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Staff", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Staff", exact: true })).toHaveCount(0);

  await page.goto("/dashboard/users");
  await expect(page).toHaveURL(/\/intake$/);
  await expect(page.getByRole("heading", { name: "Staff accounts" })).toHaveCount(0);

  const res = await page.request.post("/api/users", {
    data: { name: "x", email: `x@${TEST_DOMAIN}`, role: "admin", password: "12345678" },
  });
  expect(res.status()).toBe(403);
});
