import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireStaffApi } from "@/lib/session";
import { audit, setTemporaryPassword, TempPassword } from "@/lib/staff";

const Reset = z.object({ password: TempPassword });

// Admin sets a new temporary password; the staff member must change it at next sign-in.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { staff, error } = await requireStaffApi(req, "users");
  if (error) return error;
  const { id } = await params;

  const parsed = Reset.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  if (id === staff.id) return Response.json({ error: "Change your own password from your name in the header." }, { status: 400 });

  const found = await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, staff.tenantId)))
      .for("update");
    if (!target) return false;
    await setTemporaryPassword(tx, id, parsed.data.password);
    await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "user.password_reset", entityType: "user", entityId: id });
    return true;
  });
  if (!found) return Response.json({ error: "User not found" }, { status: 404 });
  return Response.json({ ok: true });
}
