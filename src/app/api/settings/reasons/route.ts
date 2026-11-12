import { and, eq, max } from "drizzle-orm";
import { z } from "zod";
import { isUuid } from "@/db";
import { rejectReasons } from "@/db/schema";
import { act, badRequest } from "@/lib/api";
import { FlowError, NotFoundError } from "@/lib/flow";
import { CAT } from "@/lib/rediscovery/categories";
import { isActiveCategory } from "@/lib/rediscovery/data";
import { firstIssue } from "@/lib/intake";
import { ensureListDefaults } from "@/lib/lists-db";
import { requireStaffApi } from "@/lib/session";
import { audit } from "@/lib/staff";

const label = z.string("Enter a reason").trim().min(2, "Enter a reason").max(100, "Reason is too long");
const categoryCode = z.string().trim().min(1).max(40).optional(); // reject_category code (Settings → Lists)
const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), label, categoryCode }),
  z.object({ action: z.literal("update"), reasonId: z.string().refine(isUuid), label, active: z.boolean(), categoryCode }),
]);

// Settings → reject reasons (admin). Earlier rejections keep the text they were given.
export async function POST(req: Request) {
  const { staff, error } = await requireStaffApi(req, "settings");
  if (error) return error;
  const parsed = Action.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const a = parsed.data;
  const tenantId = staff.tenantId;
  await ensureListDefaults(tenantId); // the categories a reason can point at
  return act(
    staff,
    async (tx) => {
      // a reason always has a category (Phase 3.6); a new one defaults to Other
      if (a.categoryCode && !(await isActiveCategory(tx, tenantId, a.categoryCode))) throw new FlowError("Choose a category from the list.");
      if (a.action === "create") {
        const [{ top }] = await tx.select({ top: max(rejectReasons.position) }).from(rejectReasons).where(eq(rejectReasons.tenantId, tenantId));
        const [row] = await tx.insert(rejectReasons).values({ tenantId, label: a.label, position: (top ?? 0) + 1, categoryCode: a.categoryCode ?? CAT.other }).returning({ id: rejectReasons.id });
        await audit(tx, { tenantId, actorUserId: staff.id, action: "reject_reason.create", entityType: "reject_reason", entityId: row.id });
        return;
      }
      const [row] = await tx
        .update(rejectReasons)
        .set({ label: a.label, active: a.active, sample: false, ...(a.categoryCode ? { categoryCode: a.categoryCode } : {}) })
        .where(and(eq(rejectReasons.id, a.reasonId), eq(rejectReasons.tenantId, tenantId)))
        .returning({ id: rejectReasons.id });
      if (!row) throw new NotFoundError("Reason not found");
      await audit(tx, { tenantId, actorUserId: staff.id, action: "reject_reason.update", entityType: "reject_reason", entityId: row.id, meta: { active: a.active, category: a.categoryCode ?? null } });
    },
    "This reason is already on the list.",
  );
}
