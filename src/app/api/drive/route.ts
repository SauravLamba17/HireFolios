import { z } from "zod";
import { isUuid } from "@/db";
import { act, badRequest } from "@/lib/api";
import { addPanel, assign, endDay, markGone, requeue, updatePanel } from "@/lib/drive";
import { firstIssue } from "@/lib/intake";
import { requireStaffApi } from "@/lib/session";

const id = z.string().refine(isUuid, "Not found");
const Action = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("addPanel"),
    name: z.string().trim().min(1, "Enter the room name").max(40, "Room name is too long"),
    interviewerId: z.string().min(1, "Choose the interviewer"),
    stageId: id,
  }),
  z.object({
    action: z.literal("updatePanel"),
    panelId: id,
    status: z.enum(["available", "away", "closed"]).optional(),
    interviewerId: z.string().min(1).optional(),
    stageId: id.optional(),
  }),
  z.object({ action: z.literal("assign"), panelId: id, applicationId: id.optional() }),
  z.object({ action: z.literal("requeue"), applicationId: id }),
  z.object({ action: z.literal("mark"), applicationId: id, kind: z.enum(["no_show", "withdrawn"]) }),
  z.object({ action: z.literal("endDay") }),
  z.object({ action: z.literal("reopen") }),
]);

// Drive board actions (HR / admin). Every action is tenant-scoped inside src/lib/drive.ts.
export async function POST(req: Request) {
  const { staff, error } = await requireStaffApi(req, "driveManage");
  if (error) return error;
  const parsed = Action.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const a = parsed.data;
  return act(
    staff,
    async (tx) => {
      switch (a.action) {
        case "addPanel":
          return addPanel(tx, staff, a);
        case "updatePanel":
          return updatePanel(tx, staff, a);
        case "assign":
          return assign(tx, staff, a.panelId, a.applicationId);
        case "requeue":
          return requeue(tx, staff, a.applicationId);
        case "mark":
          return markGone(tx, staff, a.applicationId, a.kind);
        case "endDay":
          return endDay(tx, staff, false);
        case "reopen":
          return endDay(tx, staff, true);
      }
    },
    "A room with this name is already on the board.",
  );
}
