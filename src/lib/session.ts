import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { roleEnum } from "@/db/schema";
import { auth } from "@/lib/auth";
import { requestOrigin } from "@/lib/origin";

export type Role = (typeof roleEnum.enumValues)[number];
export type Permission = "dashboard" | "candidates" | "intake" | "settings" | "users";

// The one permission map. Every role must be listed (TypeScript enforces it).
// Interviewers get candidate access with the queue in Phase 2.
export const ROLES = {
  admin: ["dashboard", "candidates", "intake", "settings", "users"],
  hr: ["dashboard", "candidates", "intake"],
  interviewer: ["dashboard"],
  manager: ["dashboard", "candidates"],
} as const satisfies Record<Role, readonly Permission[]>;

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  hr: "HR",
  interviewer: "Interviewer",
  manager: "Manager",
};

export const isRole = (v: unknown): v is Role => typeof v === "string" && v in ROLES;

export const can = (role: Role, permission: Permission) =>
  (ROLES[role] as readonly Permission[]).includes(permission);

export const homePath = (role: Role) => (role === "hr" ? "/intake" : "/dashboard");

export type Staff = {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenantId: string;
  /** Temporary password from an admin: nothing but /account/password until it is changed. */
  mustChangePassword: boolean;
};

export const PASSWORD_PAGE = "/account/password";

async function staffFrom(h: Headers): Promise<Staff | null> {
  const u = (await auth.api.getSession({ headers: h }))?.user;
  if (!u || !u.active || !u.tenantId || !isRole(u.role)) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role, tenantId: u.tenantId, mustChangePassword: u.mustChangePassword === true };
}

/** Signed-in, active staff member for this request, or null. Does not check the password rule. */
export const getStaff = cache(async () => staffFrom(await headers()));

/**
 * Pages: signed-out → /login, temporary password → /account/password,
 * missing permission → the role's home page.
 */
export async function requireStaff(permission?: Permission): Promise<Staff> {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.mustChangePassword) redirect(PASSWORD_PAGE);
  if (permission && !can(staff.role, permission)) redirect(homePath(staff.role));
  return staff;
}

// CSRF guard for writes: browsers send Origin on cross-site POST/PATCH/DELETE.
function isCrossSite(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return false;
  const origin = req.headers.get("origin");
  return origin !== null && origin !== requestOrigin(req);
}

/** API routes: `const { staff, error } = await requireStaffApi(req, "users"); if (error) return error;` */
export async function requireStaffApi(
  req: Request,
  permission?: Permission,
): Promise<{ staff: Staff; error?: never } | { staff?: never; error: Response }> {
  if (isCrossSite(req)) return { error: Response.json({ error: "Cross-site request blocked" }, { status: 403 }) };
  const staff = await staffFrom(req.headers);
  if (!staff) return { error: Response.json({ error: "Not signed in" }, { status: 401 }) };
  if (staff.mustChangePassword) {
    return { error: Response.json({ error: "Change your temporary password first." }, { status: 403 }) };
  }
  if (permission && !can(staff.role, permission)) {
    return { error: Response.json({ error: "Not allowed" }, { status: 403 }) };
  }
  return { staff };
}
