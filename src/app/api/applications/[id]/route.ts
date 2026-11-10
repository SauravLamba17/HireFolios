import { z } from "zod";
import { isUuid } from "@/db";
import { outcomeEnum } from "@/db/schema";
import { act, badRequest } from "@/lib/api";
import { override, resume } from "@/lib/drive";
import { firstIssue } from "@/lib/intake";
import { can, requireStaffApi } from "@/lib/session";

const reason = z.string("Give a reason").trim().min(3, "Give a reason (at least 3 characters)").max(500, "Reason is too long");
const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("moveStage"), stageId: z.string().refine(isUuid, "Choose a stage"), reason }),
  z.object({ action: z.literal("setOutcome"), outcome: z.enum(outcomeEnum.enumValues, "Choose an outcome"), rejectReason: z.string().trim().nullable(), reason }),
  z.object({ action: z.literal("resume") }),
]);

// Profile actions: manager/admin override (with a reason) and resuming a candidate on hold.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { staff, error } = await requireStaffApi(req);
  if (error) return error;
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  // Permission first, so people without it learn nothing from validation messages.
  if (!can(staff.role, (body as { action?: string } | null)?.action === "resume" ? "resume" : "override")) {
    return Response.json({ error: "Not allowed" }, { status: 403 });
  }
  const parsed = Action.safeParse(body);
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const a = parsed.data;
  return act(staff, (tx) =>
    a.action === "resume"
      ? resume(tx, staff, id)
      : a.action === "moveStage"
        ? override(tx, staff, { applicationId: id, reason: a.reason, kind: "stage", stageId: a.stageId })
        : override(tx, staff, { applicationId: id, reason: a.reason, kind: "outcome", outcome: a.outcome, rejectReason: a.rejectReason }),
  );
}
