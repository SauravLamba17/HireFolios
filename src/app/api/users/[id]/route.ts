import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { roleEnum, sessions, twoFactors, users } from "@/db/schema";
import { requireStaffApi } from "@/lib/session";
import { audit } from "@/lib/staff";

const UpdateStaff = z
  .object({
    role: z.enum(roleEnum.enumValues, "Choose a role").optional(),
    active: z.boolean().optional(),
    signOut: z.literal(true).optional(),
    resetTwoFactor: z.literal(true).optional(), // lost phone: they set it up again at the next sign-in
    unlock: z.literal(true).optional(), // locked after wrong passwords
  })
  .refine((v) => v.role !== undefined || v.active !== undefined || v.signOut || v.resetTwoFactor || v.unlock, "Nothing to change");

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { staff, error } = await requireStaffApi(req, "users");
  if (error) return error;
  const { id } = await params;

  const parsed = UpdateStaff.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  // An admin can't demote or lock out themselves, so a tenant always keeps one active admin.
  if (id === staff.id) return Response.json({ error: "You can't change your own role or status." }, { status: 400 });

  const found = await db.transaction(async (tx) => {
    const sameTenant = and(eq(users.id, id), eq(users.tenantId, staff.tenantId));
    const [target] = await tx.select({ role: users.role, active: users.active }).from(users).where(sameTenant).for("update");
    if (!target) return false;

    const { role, active } = parsed.data;
    const base = { tenantId: staff.tenantId, actorUserId: staff.id, entityType: "user", entityId: id };
    if (role !== undefined && role !== target.role) {
      await tx.update(users).set({ role }).where(sameTenant);
      await audit(tx, { ...base, action: "user.role_change", meta: { from: target.role, to: role } });
    }
    if (parsed.data.resetTwoFactor) {
      await tx.delete(twoFactors).where(eq(twoFactors.userId, id));
      await tx.update(users).set({ twoFactorEnabled: false }).where(sameTenant);
      await tx.delete(sessions).where(eq(sessions.userId, id));
      await audit(tx, { ...base, action: "user.two_factor_reset" });
    }
    if (parsed.data.unlock) {
      await tx.update(users).set({ lockedUntil: null, failedSignIns: 0 }).where(sameTenant);
      await audit(tx, { ...base, action: "user.unlock" });
    }
    if (parsed.data.signOut) {
      // e.g. the lobby TV's 30-day session: ends it on every device now
      await tx.delete(sessions).where(eq(sessions.userId, id));
      await audit(tx, { ...base, action: "user.sign_out" });
    }
    if (active !== undefined && active !== target.active) {
      await tx.update(users).set({ active }).where(sameTenant);
      if (!active) await tx.delete(sessions).where(eq(sessions.userId, id)); // sign them out now
      await audit(tx, { ...base, action: active ? "user.reactivate" : "user.deactivate" });
    }
    return true;
  });
  if (!found) return Response.json({ error: "User not found" }, { status: 404 });
  return Response.json({ ok: true });
}
