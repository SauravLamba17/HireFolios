import { z } from "zod";
import { isUuid } from "@/db";
import { act, badRequest } from "@/lib/api";
import { firstIssue } from "@/lib/intake";
import { todayIST } from "@/lib/ist";
import { lpaToRupees } from "@/lib/money";
import { acceptSuggestion, addOtherOffer, addTag, dismissSuggestion, removeTag } from "@/lib/rediscovery/actions";
import { requireStaffApi } from "@/lib/session";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date");
const optText = (max: number, what: string) =>
  z
    .string()
    .trim()
    .max(max, `${what} is too long (${max} characters max)`)
    .nullable()
    .optional()
    .transform((v) => v || null);
const lpa = z.number("Enter the CTC in LPA").min(0, "CTC can't be negative").max(100, "CTC looks too high (LPA = lakh per year)").nullable();

const code = z.string("Choose a tag").trim().min(1, "Choose a tag").max(40);
const note = optText(500, "Note");
const needNote = z.string("Add a note").trim().min(3, "Add a note (at least 3 characters)").max(500, "Note is too long (500 characters max)");
const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("tagAdd"), code, note }),
  z.object({ action: z.literal("tagRemove"), tagId: z.string().refine(isUuid, "Tag not found"), note: needNote }),
  z.object({ action: z.literal("suggestionAccept"), tag: code, note }),
  z.object({ action: z.literal("suggestionDismiss"), tag: code, note }),
  z
    .object({
      action: z.literal("otherOffer"),
      company: optText(100, "Company"),
      offeredCtcLpa: lpa,
      joiningDate: day.nullable(),
      notedOn: day.refine((d) => d <= todayIST(), "The noted date can't be in the future"),
    })
    .refine((o) => o.company || o.offeredCtcLpa !== null || o.joiningDate, "Enter the company, the CTC or the joining date"),
]);

// HR-only rediscovery actions on one candidate (docs/REDISCOVERY.md). HR, manager, admin.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { staff, error } = await requireStaffApi(req, "rediscovery");
  if (error) return error;
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const parsed = Action.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const a = parsed.data;
  return act(staff, async (tx): Promise<unknown> => {
    switch (a.action) {
      case "tagAdd":
        return addTag(tx, staff, id, { code: a.code, note: a.note });
      case "tagRemove":
        return removeTag(tx, staff, id, { tagId: a.tagId, note: a.note });
      case "suggestionAccept":
        return acceptSuggestion(tx, staff, id, { tag: a.tag, note: a.note });
      case "suggestionDismiss":
        return dismissSuggestion(tx, staff, id, { tag: a.tag, note: a.note });
      case "otherOffer":
        return addOtherOffer(tx, staff, id, { company: a.company, offeredCtc: a.offeredCtcLpa === null ? null : lpaToRupees(a.offeredCtcLpa), joiningDate: a.joiningDate, notedOn: a.notedOn });
    }
  });
}
