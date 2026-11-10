import { z } from "zod";
import { db } from "@/db";
import { roleEnum } from "@/db/schema";
import { requireStaffApi } from "@/lib/session";
import { audit, createStaff, TempPassword } from "@/lib/staff";

const CreateStaff = z.object({
  name: z.string("Enter a name").trim().min(1, "Enter a name").max(100, "Name is too long"),
  email: z.string("Enter an email").trim().max(254).pipe(z.email("Enter a valid email")),
  role: z.enum(roleEnum.enumValues, "Choose a role"),
  password: TempPassword,
});

export async function POST(req: Request) {
  const { staff, error } = await requireStaffApi(req, "users");
  if (error) return error;

  const parsed = CreateStaff.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const id = await db.transaction(async (tx) => {
    const id = await createStaff(tx, { ...parsed.data, tenantId: staff.tenantId, temporary: true });
    if (id) {
      await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "user.create", entityType: "user", entityId: id, meta: { role: parsed.data.role } });
    }
    return id;
  });
  if (!id) return Response.json({ error: "Someone already uses this email." }, { status: 409 });
  return Response.json({ id }, { status: 201 });
}
