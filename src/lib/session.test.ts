import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

const { ROLES, can, homePath, requireStaff, requireStaffApi } = await import("./session");
type Permission = import("./session").Permission;
const { roleEnum } = await import("@/db/schema");
const { requestOrigin } = await import("./origin");

const user = (over: Record<string, unknown> = {}) => ({
  user: { id: "u1", name: "A", email: "a@example.test", role: "hr", tenantId: "t1", active: true, ...over },
});
const req = (init: RequestInit = {}) => new Request("http://localhost:3000/api/x", { method: "POST", ...init, headers: { host: "localhost:3000", ...init.headers } });

describe("role rules", () => {
  it("has a permission list for every database role", () => {
    expect(Object.keys(ROLES).sort()).toEqual([...roleEnum.enumValues].sort());
  });

  it("only admins manage users", () => {
    expect(can("admin", "users")).toBe(true);
    for (const r of ["hr", "interviewer", "manager"] as const) expect(can(r, "users")).toBe(false);
  });

  it("intake is for admin and HR only", () => {
    expect(can("admin", "intake")).toBe(true);
    expect(can("hr", "intake")).toBe(true);
    expect(can("interviewer", "intake")).toBe(false);
    expect(can("manager", "intake")).toBe(false);
  });

  it("candidate list for admin, HR and manager; not interviewers", () => {
    expect(["admin", "hr", "manager"].every((r) => can(r as never, "candidates"))).toBe(true);
    expect(can("interviewer", "candidates")).toBe(false);
  });

  it("only admins change settings", () => {
    expect(can("admin", "settings")).toBe(true);
    for (const r of ["hr", "interviewer", "manager"] as const) expect(can(r, "settings")).toBe(false);
  });

  it("each role has its own home page", () => {
    expect(homePath("hr")).toBe("/intake");
    expect(homePath("admin")).toBe("/dashboard");
    expect(homePath("interviewer")).toBe("/interview");
    expect(homePath("manager")).toBe("/dashboard");
    expect(homePath("display")).toBe("/tv");
  });

  it("every role can open its own home page (no redirect loop)", () => {
    const needs: Record<string, Permission> = { "/intake": "intake", "/dashboard": "dashboard", "/interview": "interview", "/tv": "tv" };
    for (const role of roleEnum.enumValues) expect(can(role, needs[homePath(role)])).toBe(true);
  });

  it("the lobby TV login can only open /tv", () => {
    expect(ROLES.display).toEqual(["tv"]);
  });

  it("drive board: HR and admin act, managers only watch; interviewers neither", () => {
    expect(["admin", "hr", "manager"].every((r) => can(r as never, "drive"))).toBe(true);
    expect(can("manager", "driveManage")).toBe(false);
    expect(can("hr", "driveManage") && can("admin", "driveManage")).toBe(true);
    expect(can("interviewer", "drive")).toBe(false);
  });

  it("overrides are for managers and admins; interviewers have no list or settings", () => {
    expect(can("manager", "override") && can("admin", "override")).toBe(true);
    expect(can("hr", "override") || can("interviewer", "override")).toBe(false);
    for (const p of ["dashboard", "candidates", "settings", "users", "intake"] as const) expect(can("interviewer", p)).toBe(false);
  });
});

describe("requireStaffApi", () => {
  beforeEach(() => getSession.mockReset());

  it("401 when signed out", async () => {
    getSession.mockResolvedValue(null);
    const { error } = await requireStaffApi(req());
    expect(error?.status).toBe(401);
  });

  it("401 when the account is deactivated", async () => {
    getSession.mockResolvedValue(user({ active: false }));
    expect((await requireStaffApi(req())).error?.status).toBe(401);
  });

  it("401 when the user has no tenant or an unknown role", async () => {
    getSession.mockResolvedValue(user({ tenantId: null }));
    expect((await requireStaffApi(req())).error?.status).toBe(401);
    getSession.mockResolvedValue(user({ role: "owner" }));
    expect((await requireStaffApi(req())).error?.status).toBe(401);
  });

  it("403 when the role lacks the permission", async () => {
    getSession.mockResolvedValue(user({ role: "hr" }));
    const { error } = await requireStaffApi(req(), "users");
    expect(error?.status).toBe(403);
  });

  it("returns staff with tenant when allowed", async () => {
    getSession.mockResolvedValue(user({ role: "admin" }));
    const { staff, error } = await requireStaffApi(req(), "users");
    expect(error).toBeUndefined();
    expect(staff).toEqual({ id: "u1", name: "A", email: "a@example.test", role: "admin", tenantId: "t1", mustChangePassword: false });
  });

  it("403 for a cross-site write, before looking at the session", async () => {
    getSession.mockResolvedValue(user({ role: "admin" }));
    const { error } = await requireStaffApi(req({ headers: { origin: "http://evil.example" } }), "users");
    expect(error?.status).toBe(403);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("allows same-origin writes and reads without Origin", async () => {
    getSession.mockResolvedValue(user({ role: "admin" }));
    expect((await requireStaffApi(req({ headers: { origin: "http://localhost:3000" } }), "users")).staff).toBeDefined();
    expect((await requireStaffApi(req({ method: "GET" }), "users")).staff).toBeDefined();
  });

  it("allows writes from the office LAN address the request was sent to", async () => {
    getSession.mockResolvedValue(user({ role: "admin" }));
    const lan = req({ headers: { host: "192.168.1.7:3000", origin: "http://192.168.1.7:3000" } });
    expect((await requireStaffApi(lan, "users")).staff).toBeDefined();
  });
});

describe("forced password change (temporary password)", () => {
  beforeEach(() => getSession.mockReset());

  it("APIs answer 403 until the password is changed", async () => {
    getSession.mockResolvedValue(user({ role: "admin", mustChangePassword: true }));
    const { error } = await requireStaffApi(req(), "users");
    expect(error?.status).toBe(403);
    expect(await error?.json()).toEqual({ error: "Change your temporary password first." });
  });

  it("pages redirect to /account/password, even without a permission", async () => {
    getSession.mockResolvedValue(user({ role: "hr", mustChangePassword: true }));
    await expect(requireStaff("intake")).rejects.toThrow("REDIRECT /account/password");
    await expect(requireStaff()).rejects.toThrow("REDIRECT /account/password");
  });

  it("the rule wins over the role check, and goes away once changed", async () => {
    getSession.mockResolvedValue(user({ role: "interviewer", mustChangePassword: true }));
    await expect(requireStaff("users")).rejects.toThrow("REDIRECT /account/password");
    getSession.mockResolvedValue(user({ role: "hr", mustChangePassword: false }));
    await expect(requireStaff("intake")).resolves.toMatchObject({ role: "hr" });
  });

  it("signed-out users still go to /login first", async () => {
    getSession.mockResolvedValue(null);
    await expect(requireStaff("intake")).rejects.toThrow("REDIRECT /login");
  });
});

describe("requestOrigin", () => {
  const r =(headers: Record<string, string>) => new Request("http://0.0.0.0:3000/api/auth/sign-in/email", { headers });

  it("uses the Host header, not the server's bind address", () => {
    expect(requestOrigin(r({ host: "192.168.1.7:3000" }))).toBe("http://192.168.1.7:3000");
  });
  it("respects a reverse proxy's forwarded host and protocol", () => {
    expect(requestOrigin(r({ host: "app:3000", "x-forwarded-host": "jobs.example.in", "x-forwarded-proto": "https" }))).toBe("https://jobs.example.in");
  });
  it("is null without a host", () => {
    expect(requestOrigin(new Request("http://x/"))).toBeNull();
  });
});

describe("Phase 3 permissions", () => {
  it("exports and rights requests: admin and HR; reports also for managers; audit log admin only", () => {
    expect(can("hr", "export") && can("admin", "export") && !can("manager", "export")).toBe(true);
    expect(can("hr", "privacy") && can("admin", "privacy") && !can("manager", "privacy")).toBe(true);
    expect(can("manager", "reports") && can("hr", "reports") && can("admin", "reports")).toBe(true);
    expect(can("admin", "audit") && !can("hr", "audit") && !can("manager", "audit")).toBe(true);
    expect(ROLES.interviewer).toEqual(["interview"]);
    expect(ROLES.display).toEqual(["tv"]);
  });
});

describe("TV session length", () => {
  it("lobby TV 30 days, everyone else one 12-hour shift (defaults); STAFF_SESSION_HOURS / DISPLAY_SESSION_DAYS change them", async () => {
    const { parseConfig } = await import("./config");
    const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db", UPLOAD_DIR: process.cwd(), BETTER_AUTH_URL: "http://localhost:3000", BETTER_AUTH_SECRET: "x".repeat(32) };
    const d = parseConfig(base);
    expect(d.DISPLAY_SESSION_DAYS * 24 * 3600).toBe(30 * 24 * 3600);
    expect(d.STAFF_SESSION_HOURS * 3600).toBe(12 * 3600);
    const c = parseConfig({ ...base, STAFF_SESSION_HOURS: "9", DISPLAY_SESSION_DAYS: "7" });
    expect([c.STAFF_SESSION_HOURS, c.DISPLAY_SESSION_DAYS]).toEqual([9, 7]);
  });
});
