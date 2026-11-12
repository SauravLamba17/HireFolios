import { expect, test, type Browser, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import postgres from "postgres";
import { shoot, signIn, VIEWPORTS } from "./helpers";

// The header on one row for every role at the office screen sizes, with very long company and staff names; every link
// and menu item opens its page; menus work by keyboard and close on an outside click. Throwaway tenant, rows made here.
const run = Date.now().toString(36);
const sql = postgres(process.env.DATABASE_URL!);
type Role = "admin" | "hr" | "manager" | "interviewer";
const ROLES: Role[] = ["admin", "hr", "manager", "interviewer"];
const who = {} as Record<Role, { email: string; password: string; name: string }>;
const pages = {} as Record<Role, Page>;
let tenantId = "";

// What each role sees: visible links, then the two menus (label → items). Must match src/components/header.tsx.
const NAV: Record<Role, { links: string[]; menus: Record<string, string[]> }> = {
  admin: {
    links: ["Candidates", "+ New candidate", "Drive"],
    menus: {
      Rediscovery: ["Pool", "Bulk hiring", "Hiring pushes", "Suggestions", "Call-backs", "Joining soon"],
      Admin: ["Interview", "Reports", "Privacy", "Settings", "Staff", "Audit"],
    },
  },
  hr: {
    links: ["+ New candidate", "Drive", "Candidates"],
    menus: { Rediscovery: ["Pool", "Bulk hiring", "Hiring pushes", "Suggestions", "Call-backs", "Joining soon"], More: ["Reports", "Privacy"] },
  },
  manager: {
    links: ["Candidates", "Drive", "Reports"],
    menus: { Rediscovery: ["Pool", "Bulk hiring", "Hiring pushes", "Suggestions", "Call-backs", "Joining soon"], More: ["Interview"] },
  },
  interviewer: { links: ["Interview"], menus: {} },
};

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  // the longest company names Settings → Company allows (short name: 30 characters)
  const [t] = await sql`insert into tenants (name, slug, token_prefix, short_name, profile_sample)
    values (${"Simplen Billing e-Services Private Limited — Mohali Walk-in Centre " + run}, ${`e2e-hdr-${run}`}, 'H', ${"Simplen Billing e-Services Mo"}, false) returning id`;
  tenantId = t.id;
  await sql`insert into locations (tenant_id, name) values (${tenantId}, 'HDR office')`;
  await sql`insert into stages (tenant_id, name, position, is_interview) values (${tenantId}, 'Registered', 1, false), (${tenantId}, 'HR screen', 2, true)`;
  await sql`insert into jobs (tenant_id, title) values (${tenantId}, 'HDR job')`;
  for (const role of ROLES) {
    const id = crypto.randomUUID();
    const email = `${role}-${run}@e2e-hdr.example.test`;
    const password = `Pw-${crypto.randomUUID().slice(0, 12)}`;
    const name = `Venkataramanan Subramaniam Bhattacharya-Krishnamurthy ${role}`; // very long on purpose
    await sql`insert into users (id, name, email, role, tenant_id) values (${id}, ${name}, ${email}, ${role}, ${tenantId})`;
    await sql`insert into accounts (id, account_id, provider_id, user_id, password) values (${crypto.randomUUID()}, ${id}, 'credential', ${id}, ${await hashPassword(password)})`;
    who[role] = { email, password, name };
  }
  for (const role of ROLES) {
    pages[role] = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
    await signIn(pages[role], who[role]);
  }
});

test.afterAll(async () => {
  for (const p of Object.values(pages)) await p.context().close();
  const t = [tenantId];
  for (const q of ["drives", "panels", "audit_log", "option_items", "privacy_notices", "users", "jobs", "stages", "locations"]) await sql`delete from ${sql(q)} where tenant_id in ${sql(t)}`;
  await sql`delete from tenants where id = ${tenantId}`;
  await sql.end();
});

/** One row: every item in the header row shares the first item's vertical band, no two overlap, no sideways scroll. */
async function layout(page: Page) {
  return page.evaluate(() => {
    const row = document.querySelector('[data-testid="header-row"]')!;
    // the leaf items of the row: brand, links, menu buttons, quick-look, company, user menu
    const els = [...row.querySelectorAll(":scope > a, nav > *, :scope > div > *")].filter((el) => el.getBoundingClientRect().width > 0);
    const boxes = els.map((el) => el.getBoundingClientRect());
    const name = (el: Element) => (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 24);
    const overlaps = els.flatMap((a, i) =>
      els.slice(i + 1).flatMap((b, k) => {
        const [p, q] = [boxes[i], boxes[i + 1 + k]];
        return p.left < q.right - 1 && q.left < p.right - 1 && p.top < q.bottom - 1 && q.top < p.bottom - 1 ? [`${name(a)} × ${name(b)}`] : [];
      }),
    );
    const tops = boxes.map((r) => r.top);
    return {
      rowHeight: row.getBoundingClientRect().height,
      spread: Math.max(...tops) - Math.min(...tops),
      overlaps,
      sideways: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

for (const role of ROLES) {
  test(`${role}: header on one row at 1440, 1366x768 and 1024, long names truncated`, async () => {
    const page = pages[role];
    await page.goto(role === "interviewer" ? "/interview" : role === "hr" ? "/intake" : "/dashboard");
    for (const v of VIEWPORTS) {
      await page.setViewportSize({ width: v.width, height: v.height });
      await page.waitForTimeout(100);
      const l = await layout(page);
      expect(l.rowHeight, `${role} at ${v.name}: header height`).toBeLessThanOrEqual(66);
      expect(l.spread, `${role} at ${v.name}: items on one row`).toBeLessThanOrEqual(8);
      expect(l.overlaps, `${role} at ${v.name}: overlapping items`).toEqual([]);
      expect(l.sideways, `${role} at ${v.name}: sideways scroll`).toBeLessThanOrEqual(0);
    }
    // long names: cut with an ellipsis, full text on hover
    const user = page.getByTestId("header-user");
    expect(await user.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await expect(page.getByRole("button", { name: /account menu/ })).toHaveAttribute("aria-label", new RegExp(who[role].name));
    await expect(page.locator('header a[title^="Simplen Billing e-Services Private Limited"]')).toBeVisible();
    await shoot(page, `header-${role}`, { width: 1366, height: 768 });
  });

  test(`${role}: every link and menu item opens its page`, async () => {
    const page = pages[role];
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link")).toHaveText(NAV[role].links);
    expect(await nav.getByRole("button").allTextContents()).toEqual(Object.keys(NAV[role].menus).map((m) => `${m} ▾`));
    for (const label of NAV[role].links) {
      await nav.getByRole("link", { name: label, exact: true }).click();
      await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(page.locator("main")).toBeVisible();
    }
    for (const [menu, items] of Object.entries(NAV[role].menus)) {
      await nav.getByRole("button", { name: menu }).click();
      await expect(page.getByRole("menu")).toBeVisible();
      await expect(page.getByRole("menuitem")).toHaveText(items);
      for (const item of items) {
        if (!(await page.getByRole("menu").isVisible())) await nav.getByRole("button", { name: menu }).click();
        await page.getByRole("menuitem", { name: item, exact: true }).click();
        await expect(page.getByRole("menu")).toHaveCount(0); // closes after navigating
        await expect(page.locator("main")).toBeVisible();
        expect(await page.title()).not.toMatch(/404|error/i);
        await nav.getByRole("button", { name: menu }).click();
        await expect(page.getByRole("menuitem", { name: item, exact: true })).toHaveAttribute("aria-current", "page");
        await expect(nav.getByRole("button", { name: menu })).toHaveClass(/bg-blue-50/); // the menu lights up on its pages
        await page.keyboard.press("Escape");
      }
    }
    // account menu
    await page.getByRole("button", { name: /account menu/ }).click();
    await page.getByRole("menuitem", { name: "Change password" }).click();
    await expect(page).toHaveURL(/\/account\/password$/);
  });
}

test("keyboard only: Tab to a menu, open it, arrow through, Esc returns, Enter follows; outside click closes; quick-look by /", async () => {
  const page = pages.admin;
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/dashboard");
  // Tab from the top of the page until the Rediscovery button has focus
  await page.locator("body").focus();
  const button = page.getByRole("button", { name: "Rediscovery" });
  for (let i = 0; i < 12 && !(await button.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Pool" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Bulk hiring" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitem", { name: "Joining soon" })).toBeFocused();
  await page.keyboard.press("ArrowDown"); // wraps
  await expect(page.getByRole("menuitem", { name: "Pool" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(button).toBeFocused();
  await page.keyboard.press("ArrowUp"); // opens on the last item
  await expect(page.getByRole("menuitem", { name: "Joining soon" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/dashboard\/callbacks$/);
  // Tab out of an open menu closes it
  await button.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("menu")).toHaveCount(0);
  // a click anywhere else closes it
  await button.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await expect(page.getByRole("menu")).toHaveCount(0);
  // one menu at a time
  await button.click();
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(1);
  await expect(page.getByRole("menuitem", { name: "Staff" })).toBeVisible();
  await page.keyboard.press("Escape");
  // quick-look is a button at 1024; "/" opens and focuses the box, Esc folds it again
  const box = page.getByRole("combobox", { name: "Quick look: name or mobile" });
  await expect(box).toBeHidden();
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("/");
  await expect(box).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
  await page.getByRole("button", { name: /Quick look: find a person/ }).click();
  await expect(box).toBeFocused();
  await shoot(page, "header-admin-quicklook-open", { width: 1024, height: 768 });
  // at 1440 the box is always there
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(box).toBeVisible();
  await expect(page.getByRole("button", { name: /Quick look: find a person/ })).toBeHidden();
});
