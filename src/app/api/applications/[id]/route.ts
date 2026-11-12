import { z } from "zod";
import { isUuid } from "@/db";
import { outcomeEnum } from "@/db/schema";
import { act, badRequest } from "@/lib/api";
import { markJoined, override, recordOffer, resume } from "@/lib/drive";
import { firstIssue } from "@/lib/intake";
import { todayIST } from "@/lib/ist";
import { lpaToRupees } from "@/lib/money";
import { can, requireStaffApi, type Permission } from "@/lib/session";

const reason = z.string("Give a reason").trim().min(3, "Give a reason (at least 3 characters)").max(500, "Reason is too long");
const lpa = (what: string) => z.number(`Enter the ${what} in LPA`).min(0, "CTC cannot be negative").max(100, "CTC looks too high (LPA = lakh per year)").nullable().optional();
const rupees = (v: number | null | undefined) => (v === null || v === undefined ? null : lpaToRupees(v));
const category = z.string().trim().max(40).nullable().optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date");
const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("moveStage"), stageId: z.string().refine(isUuid, "Choose a stage"), reason }),
  z.object({
    action: z.literal("setOutcome"),
    outcome: z.enum(outcomeEnum.enumValues, "Choose an outcome"),
    rejectReason: z.string().trim().nullable(),
    reason,
    category, // offer declined only (a rejection takes its reason's category)
    costExpectedLpa: lpa("expected CTC"),
    costBudgetLpa: lpa("budget"),
  }),
  z.object({ action: z.literal("resume") }),
  z.object({
    action: z.literal("offer"),
    status: z.enum(["offered", "accepted", "declined"], "Choose the offer status"),
    offeredCtcLpa: z.number("Enter the offered CTC in LPA").min(0, "CTC can't be negative").max(100, "CTC looks too high (LPA = lakh per year)").nullable(),
    joiningDate: day.nullable(),
    declineCategory: category,
    costExpectedLpa: lpa("expected CTC"),
  }),
  z.object({ action: z.literal("joined"), joinedOn: day.refine((d) => d <= todayIST(), "The joining date can't be in the future") }),
]);

const NEEDS: Record<string, Permission> = { resume: "resume", offer: "offer", joined: "offer", moveStage: "override", setOutcome: "override" };

// Profile actions: manager/admin override (with a reason), resume from hold, offer and joining.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { staff, error } = await requireStaffApi(req);
  if (error) return error;
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  // Permission first, so people without it learn nothing from validation messages.
  if (!can(staff.role, NEEDS[(body as { action?: string } | null)?.action ?? ""] ?? "override")) {
    return Response.json({ error: "Not allowed" }, { status: 403 });
  }
  const parsed = Action.safeParse(body);
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const a = parsed.data;
  return act(staff, async (tx): Promise<unknown> => {
    switch (a.action) {
      case "resume":
        return resume(tx, staff, id);
      case "moveStage":
        return override(tx, staff, { applicationId: id, reason: a.reason, kind: "stage", stageId: a.stageId });
      case "setOutcome":
        return override(tx, staff, { applicationId: id, reason: a.reason, kind: "outcome", outcome: a.outcome, rejectReason: a.rejectReason, category: a.category ?? null, costExpected: rupees(a.costExpectedLpa), costBudget: rupees(a.costBudgetLpa) });
      case "offer":
        return recordOffer(tx, staff, id, { status: a.status, offeredCtc: rupees(a.offeredCtcLpa), joiningDate: a.joiningDate, declineCategory: a.declineCategory ?? null, costExpected: rupees(a.costExpectedLpa) });
      case "joined":
        return markJoined(tx, staff, id, a.joinedOn);
    }
  });
}
