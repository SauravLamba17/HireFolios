import path from "node:path";
import { expect, type Page } from "@playwright/test";

// Better Auth allows 3 sign-ins per 10 s per IP, counted until 10 s after the last try.
// Space them out instead of turning the limit off.
let recent: number[] = [];
async function paceSignIn() {
  const now = Date.now();
  recent = recent.filter((t) => now - t < 10_500);
  if (recent.length >= 2) await new Promise((r) => setTimeout(r, 10_500 - (now - Math.max(...recent)) + 200));
  recent = recent.filter((t) => Date.now() - t < 10_500);
  recent.push(Date.now());
}

export async function signIn(page: Page, who: { email: string; password: string }) {
  await paceSignIn();
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Another process (e.g. `npm run smoke`) may have used this IP's sign-in budget a moment ago.
  const limited = page.getByText("Too many attempts");
  await expect(limited.or(page.locator("header"))).toBeVisible();
  if (await limited.isVisible()) {
    await page.waitForTimeout(11_000);
    recent = [Date.now()];
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page).not.toHaveURL(/\/login$/);
}

// Set SHOTS_DIR to save UI screenshots there (keep it outside the repo).
const SHOTS = process.env.SHOTS_DIR;
export const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1024", width: 1024, height: 768 },
  { name: "800x1280", width: 800, height: 1280 },
];

/** Full-page screenshot at each size, then back to `restore`. */
export async function shoot(page: Page, name: string, restore = { width: 1280, height: 800 }) {
  if (!SHOTS) return;
  for (const v of VIEWPORTS) {
    await page.setViewportSize({ width: v.width, height: v.height });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SHOTS, `${name}-${v.name}.png`), fullPage: true });
  }
  await page.setViewportSize(restore);
}
