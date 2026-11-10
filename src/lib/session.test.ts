import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));

const { ROLES, can, homePath, requireStaffApi } = await import("./session");
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

  it("HR lands on intake, everyone else on the dashboard", () => {
    expect(homePath("hr")).toBe("/intake");
    expect(homePath("admin")).toBe("/dashboard");
    expect(homePath("interviewer")).toBe("/dashboard");
    expect(homePath("manager")).toBe("/dashboard");
  });

  it("every role can open its own home page (no redirect loop)", () => {
    for (const role of roleEnum.enumValues) {
      expect(can(role, homePath(role) === "/intake" ? "intake" : "dashboard")).toBe(true);
    }
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
    expect(staff).toEqual({ id: "u1", name: "A", email: "a@example.test", role: "admin", tenantId: "t1" });
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
