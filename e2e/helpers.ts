import path from "node:path";
import { expect, type Page } from "@playwright/test";

// The server allows SIGN_IN_LIMIT ("20/60": attempts / seconds) per address; the count only resets once a whole window
// passes after the last allowed attempt. Pace to it instead of turning the limit off (same .env as the server).
const [LIMIT_MAX, LIMIT_SECONDS] = (process.env.SIGN_IN_LIMIT || "20/60").split("/").map(Number);
const WINDOW_MS = LIMIT_SECONDS * 1000 + 300;
let used = 0;
let last = 0;
export async function paceSignIn() {
  if (Date.now() - last >= WINDOW_MS) used = 0;
  if (used >= LIMIT_MAX - 1) {
    await new Promise((r) => setTimeout(r, Math.max(0, last + WINDOW_MS - Date.now())));
    used = 0;
  }
  used++;
  last = Date.now();
}

/** Press "Sign in" on the filled form. Another process (e.g. `npm run smoke`) may have used this address's sign-in budget a
 *  moment ago: on 429, wait for the window to pass and press again (once). */
export async function submitSignIn(page: Page) {
  for (let tries = 0; ; tries++) {
    const res = page.waitForResponse((r) => r.url().includes("/api/auth/sign-in/email"));
    await page.getByRole("button", { name: "Sign in" }).click();
    if ((await res).status() !== 429 || tries === 1) return;
    await page.waitForTimeout(WINDOW_MS);
    used = 1;
    last = Date.now();
  }
}

export async function signIn(page: Page, who: { email: string; password: string }) {
  await paceSignIn();
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await submitSignIn(page);
  await expect(page).not.toHaveURL(/\/login$/);
}

// Set SHOTS_DIR to save UI screenshots there (keep it outside the repo).
const SHOTS = process.env.SHOTS_DIR;
export const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1366x768", width: 1366, height: 768 }, // common HR desk / office laptop
  { name: "1024", width: 1024, height: 768 },
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
