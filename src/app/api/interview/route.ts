import { z } from "zod";
import { isUuid } from "@/db";
import { act, badRequest } from "@/lib/api";
import { decide, setMyStatus } from "@/lib/drive";
import { firstIssue } from "@/lib/intake";
import { lpaToRupees } from "@/lib/money";
import { requireStaffApi } from "@/lib/session";

// Cost figures of a cost rejection (optional), LPA from the form.
const lpa = z.number("Enter the amount in LPA").min(0, "CTC cannot be negative").max(100, "CTC looks too high (LPA = lakh per year)").nullable().optional();

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), status: z.enum(["available", "away"]) }),
  z.object({
    action: z.literal("decide"),
    applicationId: z.string().refine(isUuid, "Not found"),
    scores: z.record(z.string(), z.int("Scores are 1 to 5").min(1, "Scores are 1 to 5").max(5, "Scores are 1 to 5")),
    notes: z
      .string()
      .trim()
      .max(2000, "Notes are too long (2000 characters max)")
      .transform((v) => v || null),
    decision: z.enum(["pass", "hold", "reject"], "Choose Pass, Hold or Reject"),
    rejectReason: z.string().trim().max(200).nullable(),
    costExpectedLpa: lpa,
    costBudgetLpa: lpa,
  }),
]);

// The interviewer's own panel: availability and the decision for the candidate in front of them.
export async function POST(req: Request) {
  const { staff, error } = await requireStaffApi(req, "interview");
  if (error) return error;
  const parsed = Action.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const a = parsed.data;
  return act(staff, async (tx): Promise<unknown> => (a.action === "status" ? setMyStatus(tx, staff, a.status) : decide(tx, staff, { ...a, costExpected: rupees(a.costExpectedLpa), costBudget: rupees(a.costBudgetLpa) })));
}

const rupees = (v: number | null | undefined) => (v === null || v === undefined ? null : lpaToRupees(v));
