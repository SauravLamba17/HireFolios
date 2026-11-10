import { and, asc, eq, max } from "drizzle-orm";
import { z } from "zod";
import { isUuid } from "@/db";
import { stages } from "@/db/schema";
import { act, badRequest } from "@/lib/api";
import { NotFoundError } from "@/lib/flow";
import { firstIssue } from "@/lib/intake";
import { requireStaffApi } from "@/lib/session";
import { audit } from "@/lib/staff";

const name = z.string("Enter a stage name").trim().min(2, "Enter a stage name").max(60, "Stage name is too long");
const criteria = z
  .array(z.object({ label: z.string().trim().min(1, "Criteria need a name").max(60, "Criterion name is too long"), required: z.boolean() }))
  .max(12, "At most 12 criteria")
  .refine((c) => new Set(c.map((x) => x.label.toLowerCase())).size === c.length, "Two criteria have the same name");

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name }),
  z.object({ action: z.literal("update"), stageId: z.string().refine(isUuid), name, active: z.boolean(), isInterview: z.boolean(), criteria }),
  z.object({ action: z.literal("move"), stageId: z.string().refine(isUuid), direction: z.enum(["up", "down"]) }),
]);

// Settings → stages (admin): add, rename, reorder, activate, mark interview rounds, scorecard criteria.
export async function POST(req: Request) {
  const { staff, error } = await requireStaffApi(req, "settings");
  if (error) return error;
  const parsed = Action.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const a = parsed.data;
  const tenantId = staff.tenantId;
  const log = (tx: Parameters<typeof audit>[0], action: string, id: string, meta?: Record<string, string | number | boolean | null>) =>
    audit(tx, { tenantId, actorUserId: staff.id, action, entityType: "stage", entityId: id, meta });

  return act(
    staff,
    async (tx) => {
      if (a.action === "create") {
        const [{ top }] = await tx.select({ top: max(stages.position) }).from(stages).where(eq(stages.tenantId, tenantId));
        const [row] = await tx.insert(stages).values({ tenantId, name: a.name, position: (top ?? 0) + 1 }).returning({ id: stages.id });
        await log(tx, "stage.create", row.id);
        return;
      }
      const all = await tx.select().from(stages).where(eq(stages.tenantId, tenantId)).orderBy(asc(stages.position)).for("update");
      const i = all.findIndex((s) => s.id === a.stageId);
      if (i < 0) throw new NotFoundError("Stage not found");
      const cur = all[i];
      if (a.action === "move") {
        const j = a.direction === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= all.length) return;
        const other = all[j];
        // positions are not unique, so a plain swap is safe
        await tx.update(stages).set({ position: other.position }).where(eq(stages.id, cur.id));
        await tx.update(stages).set({ position: cur.position }).where(eq(stages.id, other.id));
        await log(tx, "stage.move", cur.id, { direction: a.direction });
        return;
      }
      const changed = (["name", "active", "isInterview", "criteria"] as const).filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(a[k]));
      await tx
        .update(stages)
        .set({ name: a.name, active: a.active, isInterview: a.isInterview, criteria: a.criteria, sample: false })
        .where(and(eq(stages.id, cur.id), eq(stages.tenantId, tenantId)));
      await log(tx, "stage.update", cur.id, { changed: changed.join(","), active: a.active, isInterview: a.isInterview, criteria: a.criteria.length, confirmedSample: cur.sample });
    },
    "Another stage already has this name.",
  );
}
