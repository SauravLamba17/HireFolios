import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Supported browsers (Chrome, Edge) at the office screen sizes: key pages load, nothing scrolls sideways, and the
// "please use Chrome or Edge" notice stays hidden. Run with PW_CHANNEL=chrome and PW_CHANNEL=msedge.
const admin = { email: process.env.SEED_ADMIN_EMAIL!, password: process.env.SEED_ADMIN_PASSWORD! };
const PAGES = ["/dashboard", "/intake", "/dashboard/drive", "/dashboard/reports", "/dashboard/settings", "/dashboard/settings/lists", "/dashboard/settings/notice", "/dashboard/settings/company", "/tv"];

for (const size of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  test(`key pages at ${size.width}x${size.height} in ${process.env.PW_CHANNEL || "chromium"}`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: size })).newPage();
    await page.goto("/login");
    const version = await page.evaluate(() => navigator.userAgent.match(/(?:Edg|Chrome)\/[\d.]+/g)?.join(" "));
    test.info().annotations.push({ type: "browser", description: version ?? "?" });
    await expect(page.getByRole("note")).toHaveCount(0);
    await signIn(page, admin);
    for (const p of PAGES) {
      const res = await page.goto(p);
      expect(res?.status(), p).toBeLessThan(400);
      await expect(page.locator("main, h1").first()).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${p} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
      await expect(page.getByRole("note"), `${p} shows the browser notice`).toHaveCount(0);
    }
    await page.context().close();
  });
}
