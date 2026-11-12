import { z } from "zod";
import { act, badRequest } from "@/lib/api";
import { firstIssue } from "@/lib/intake";
import { discardDraft, ensureNotice, publishDraft, saveDraft, startDraft } from "@/lib/notice-db";
import { requireStaffApi } from "@/lib/session";
import { audit } from "@/lib/staff";

const line = (max: number) => z.string().max(max, `Text is too long (${max} characters max)`);
const Lang = z.object({
  title: line(200),
  paragraphs: z.array(line(2000)).max(12, "At most 12 paragraphs"),
  agree: line(500),
  talentPool: line(500),
  whatsapp: line(500),
  continue: line(60),
  required: line(200),
});
const opt = (max: number, msg: string) =>
  z
    .string()
    .trim()
    .max(max, msg)
    .nullable()
    .transform((v) => v || null);
const Draft = z.object({
  texts: z.object({ en: Lang, hi: Lang }),
  contactName: opt(100, "Contact name is too long"),
  contactEmail: z
    .string()
    .trim()
    .pipe(z.union([z.literal(""), z.email("Enter a valid contact email or leave it empty")]))
    .nullable()
    .transform((v) => v || null),
  contactPhone: opt(30, "Contact phone is too long").refine((v) => v === null || /^[+\d][\d\s-]{5,}$/.test(v), "Enter a valid contact phone or leave it empty"),
});
const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("save"), draft: Draft }),
  z.object({ action: z.literal("publish"), draft: Draft }),
  z.object({ action: z.literal("discard") }),
]);

// Settings → Privacy notice (admin). Edits only ever touch the draft; publishing makes it the next version and
// retires the old one (kept read-only). Consents keep the version they were given.
export async function POST(req: Request) {
  const { staff, error } = await requireStaffApi(req, "settings");
  if (error) return error;
  const parsed = Action.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const a = parsed.data;
  const tenantId = staff.tenantId;
  await ensureNotice(tenantId);
  return act(staff, async (tx) => {
    if (a.action === "start") {
      const id = await startDraft(tx, tenantId, staff.id);
      await audit(tx, { tenantId, actorUserId: staff.id, action: "notice.draft", entityType: "privacy_notice", entityId: id });
      return;
    }
    if (a.action === "discard") {
      await discardDraft(tx, tenantId);
      await audit(tx, { tenantId, actorUserId: staff.id, action: "notice.discard", entityType: "privacy_notice" });
      return;
    }
    // Paragraph boxes may be left empty: they are dropped.
    const texts = { en: { ...a.draft.texts.en, paragraphs: a.draft.texts.en.paragraphs.filter((p) => p.trim()) }, hi: { ...a.draft.texts.hi, paragraphs: a.draft.texts.hi.paragraphs.filter((p) => p.trim()) } };
    const id = await saveDraft(tx, tenantId, { ...a.draft, texts });
    if (a.action === "save") {
      await audit(tx, { tenantId, actorUserId: staff.id, action: "notice.save", entityType: "privacy_notice", entityId: id });
      return;
    }
    const { version } = await publishDraft(tx, tenantId, staff.id);
    await audit(tx, { tenantId, actorUserId: staff.id, action: "notice.publish", entityType: "privacy_notice", entityId: id, meta: { version } });
    return { version };
  });
}
