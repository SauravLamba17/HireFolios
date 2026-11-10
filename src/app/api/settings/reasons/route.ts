import { and, eq, max } from "drizzle-orm";
import { z } from "zod";
import { isUuid } from "@/db";
import { rejectReasons } from "@/db/schema";
import { act, badRequest } from "@/lib/api";
import { NotFoundError } from "@/lib/flow";
import { firstIssue } from "@/lib/intake";
import { requireStaffApi } from "@/lib/session";
import { audit } from "@/lib/staff";

const label = z.string("Enter a reason").trim().min(2, "Enter a reason").max(100, "Reason is too long");
const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), label }),
  z.object({ action: z.literal("update"), reasonId: z.string().refine(isUuid), label, active: z.boolean() }),
]);

// Settings → reject reasons (admin). Earlier rejections keep the text they were given.
export async function POST(req: Request) {
  const { staff, error } = await requireStaffApi(req, "settings");
  if (error) return error;
  const parsed = Action.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const a = parsed.data;
  const tenantId = staff.tenantId;
  return act(
    staff,
    async (tx) => {
      if (a.action === "create") {
        const [{ top }] = await tx.select({ top: max(rejectReasons.position) }).from(rejectReasons).where(eq(rejectReasons.tenantId, tenantId));
        const [row] = await tx.insert(rejectReasons).values({ tenantId, label: a.label, position: (top ?? 0) + 1 }).returning({ id: rejectReasons.id });
        await audit(tx, { tenantId, actorUserId: staff.id, action: "reject_reason.create", entityType: "reject_reason", entityId: row.id });
        return;
      }
      const [row] = await tx
        .update(rejectReasons)
        .set({ label: a.label, active: a.active, sample: false })
        .where(and(eq(rejectReasons.id, a.reasonId), eq(rejectReasons.tenantId, tenantId)))
        .returning({ id: rejectReasons.id });
      if (!row) throw new NotFoundError("Reason not found");
      await audit(tx, { tenantId, actorUserId: staff.id, action: "reject_reason.update", entityType: "reject_reason", entityId: row.id, meta: { active: a.active } });
    },
    "This reason is already on the list.",
  );
}
