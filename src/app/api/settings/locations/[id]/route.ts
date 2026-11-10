import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, isUniqueViolation, isUuid } from "@/db";
import { locations } from "@/db/schema";
import { requireStaffApi } from "@/lib/session";
import { audit } from "@/lib/staff";

const Rename = z.object({ name: z.string("Enter a name").trim().min(2, "Enter the location name").max(100, "Name is too long") });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { staff, error } = await requireStaffApi(req, "settings");
  if (error) return error;
  const { id } = await params;
  const parsed = Rename.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  if (!isUuid(id)) return Response.json({ error: "Location not found" }, { status: 404 });

  try {
    const found = await db.transaction(async (tx) => {
      const sameTenant = and(eq(locations.id, id), eq(locations.tenantId, staff.tenantId));
      const [cur] = await tx.select({ name: locations.name }).from(locations).where(sameTenant).for("update");
      if (!cur) return false;
      if (cur.name === parsed.data.name) return true;
      await tx.update(locations).set({ name: parsed.data.name }).where(sameTenant);
      await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "location.rename", entityType: "location", entityId: id });
      return true;
    });
    if (!found) return Response.json({ error: "Location not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (e) {
    if (isUniqueViolation(e, "locations_tenant_name_uq")) return Response.json({ error: "Another location already has this name." }, { status: 409 });
    throw e;
  }
}
