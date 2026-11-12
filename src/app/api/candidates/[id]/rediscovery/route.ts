import { z } from "zod";
import { isUuid } from "@/db";
import { act, badRequest } from "@/lib/api";
import { firstIssue } from "@/lib/intake";
import { todayIST } from "@/lib/ist";
import { lpaToRupees } from "@/lib/money";
import {
  acceptSuggestion,
  addOtherOffer,
  addTag,
  clearDoNotContact,
  dismissSuggestion,
  doneCallback,
  logContact,
  recordConsent,
  removeTag,
  setCallback,
  setDoNotContact,
  snoozeCallback,
  withdrawConsent,
} from "@/lib/rediscovery/actions";
import { CHANNELS, CONSENT_CHANNELS, CONTACT_OUTCOMES, PURPOSES } from "@/lib/rediscovery/contact";
import { can, requireStaffApi } from "@/lib/session";

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
const keys = <T extends Record<string, string>>(o: T, msg: string) => z.enum(Object.keys(o) as [keyof T & string, ...(keyof T & string)[]], msg);
const pastDay = day.refine((d) => d <= todayIST(), "The date can't be in the future");
const futureDay = day.refine((d) => d >= todayIST(), "Choose today or a later date");
const cbId = z.string().refine(isUuid, "Call-back not found");
const Action = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("contact"),
    channel: keys(CHANNELS, "Choose how you contacted them"),
    purpose: keys(PURPOSES, "Choose the purpose"),
    outcome: keys(CONTACT_OUTCOMES, "Choose the outcome").nullable(),
    note,
    pushId: z.string().refine(isUuid).nullable().optional(),
  }),
  z.object({ action: z.literal("dncSet"), reason: needNote }),
  z.object({ action: z.literal("dncClear"), note: needNote }),
  z.object({ action: z.literal("callbackSet"), dueOn: futureDay, note }),
  z.object({ action: z.literal("callbackSnooze"), callbackId: cbId, dueOn: futureDay, note }),
  z.object({ action: z.literal("callbackDone"), callbackId: cbId, outcome: keys(CONTACT_OUTCOMES, "Choose the outcome"), note }),
  z.object({ action: z.literal("consentRecord"), day: pastDay, channel: keys(CONSENT_CHANNELS, "Choose how they gave consent"), note, whatsapp: z.boolean() }),
  z.object({ action: z.literal("consentWithdraw"), day: pastDay }),
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
  if (a.action === "dncClear" && !can(staff.role, "contactUnblock")) return Response.json({ error: "Only an admin can clear Do not contact." }, { status: 403 });
  return act(staff, async (tx): Promise<unknown> => {
    switch (a.action) {
      case "contact":
        return logContact(tx, staff, id, { channel: a.channel, purpose: a.purpose, outcome: a.outcome, note: a.note, pushId: a.pushId ?? null });
      case "dncSet":
        return setDoNotContact(tx, staff, id, a.reason);
      case "dncClear":
        return clearDoNotContact(tx, staff, id, a.note);
      case "callbackSet":
        return setCallback(tx, staff, id, { dueOn: a.dueOn, note: a.note });
      case "callbackSnooze":
        return snoozeCallback(tx, staff, id, { callbackId: a.callbackId, dueOn: a.dueOn, note: a.note });
      case "callbackDone":
        return doneCallback(tx, staff, id, { callbackId: a.callbackId, outcome: a.outcome, note: a.note });
      case "consentRecord":
        return recordConsent(tx, staff, id, { day: a.day, channel: a.channel, note: a.note, whatsapp: a.whatsapp });
      case "consentWithdraw":
        return withdrawConsent(tx, staff, id, { day: a.day });
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
