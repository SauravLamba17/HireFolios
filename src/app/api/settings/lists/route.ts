import { and, eq, max } from "drizzle-orm";
import { z } from "zod";
import { isUuid } from "@/db";
import { optionItems } from "@/db/schema";
import { act, badRequest } from "@/lib/api";
import { FlowError, NotFoundError } from "@/lib/flow";
import { firstIssue } from "@/lib/intake";
import { LIST_KEYS } from "@/lib/lists";
import { ensureListDefaults, listRows } from "@/lib/lists-db";
import { requireStaffApi } from "@/lib/session";
import { audit } from "@/lib/staff";

const list = z.enum(LIST_KEYS, "Unknown list");
const label = z.string("Enter a name").trim().min(1, "Enter a name").max(100, "Name is too long (100 characters max)");
const itemId = z.string().refine(isUuid, "Item not found");
const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), list, label, days: z.int("Days must be a whole number").min(0).max(365).nullable().optional() }),
  z.object({ action: z.literal("update"), list, itemId, label, active: z.boolean() }),
  z.object({ action: z.literal("move"), list, itemId, direction: z.enum(["up", "down"]) }),
]);

// Settings → Lists (admin). Items are never deleted: a retired item disappears from new forms but stays on the
// candidates who have it. Renaming changes the list for new entries; older records keep the text they were saved with.
export async function POST(req: Request) {
  const { staff, error } = await requireStaffApi(req, "settings");
  if (error) return error;
  const parsed = Action.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const a = parsed.data;
  const tenantId = staff.tenantId;
  if (a.action === "create" && a.list === "notice_period" && (a.days === null || a.days === undefined)) return badRequest("Enter the number of days for a notice period.");
  if (a.action === "create" && a.list !== "notice_period" && a.days !== null && a.days !== undefined) return badRequest("Only notice periods have days.");
  await ensureListDefaults(tenantId);
  return act(
    staff,
    async (tx) => {
      if (a.action === "create") {
        if (a.list === "notice_period") {
          const [same] = await tx
            .select({ id: optionItems.id })
            .from(optionItems)
            .where(and(eq(optionItems.tenantId, tenantId), eq(optionItems.list, "notice_period"), eq(optionItems.days, a.days!)));
          if (same) throw new FlowError("A notice period with that many days is already on the list (bring it back with “In use”).");
        }
        const [{ top }] = await tx.select({ top: max(optionItems.position) }).from(optionItems).where(and(eq(optionItems.tenantId, tenantId), eq(optionItems.list, a.list)));
        const [row] = await tx
          .insert(optionItems)
          .values({ tenantId, list: a.list, label: a.label, days: a.list === "notice_period" ? a.days! : null, position: (top ?? 0) + 1 })
          .returning({ id: optionItems.id });
        await audit(tx, { tenantId, actorUserId: staff.id, action: "option_item.create", entityType: "option_item", entityId: row.id, meta: { list: a.list } });
        return;
      }
      if (a.action === "update") {
        const [row] = await tx
          .update(optionItems)
          .set({ label: a.label, active: a.active, sample: false })
          .where(and(eq(optionItems.id, a.itemId), eq(optionItems.tenantId, tenantId), eq(optionItems.list, a.list)))
          .returning({ id: optionItems.id });
        if (!row) throw new NotFoundError("Item not found");
        await audit(tx, { tenantId, actorUserId: staff.id, action: "option_item.update", entityType: "option_item", entityId: row.id, meta: { list: a.list, active: a.active } });
        return;
      }
      // move: swap with the neighbour, then renumber the whole list 1..n (positions stay tidy)
      const rows = await listRows(tx, tenantId, a.list);
      const i = rows.findIndex((r) => r.id === a.itemId);
      if (i < 0) throw new NotFoundError("Item not found");
      const j = a.direction === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= rows.length) return;
      [rows[i], rows[j]] = [rows[j], rows[i]];
      for (const [n, r] of rows.entries()) await tx.update(optionItems).set({ position: n + 1 }).where(eq(optionItems.id, r.id));
      await audit(tx, { tenantId, actorUserId: staff.id, action: "option_item.move", entityType: "option_item", entityId: a.itemId, meta: { list: a.list, direction: a.direction } });
    },
    "That name is already on this list.",
  );
}
