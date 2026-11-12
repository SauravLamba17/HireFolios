// Privacy notice versions per tenant (privacy_notices). Exactly one active version is shown at intake; an admin edits
// one draft and publishes it as the next version. A tenant without any version gets the starting text, active and
// marked "sample" (new tenants, upgraded installs, test tenants).
import "server-only";
import { cache } from "react";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { privacyNotices } from "@/db/schema";
import { FlowError } from "@/lib/flow";
import { todayIST } from "@/lib/ist";
import { CONTACT_SENTENCE, DEFAULT_NOTICE_TEXTS, DEFAULT_NOTICE_VERSION, NOTICE_LANGUAGES, noticeProblems, type NoticeTexts } from "@/lib/notice";

export type NoticeRow = {
  id: string;
  version: string;
  status: "draft" | "active" | "retired";
  effectiveDate: string | null;
  texts: NoticeTexts;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  sample: boolean;
  publishedAt: Date | null;
};
const cols = {
  id: privacyNotices.id,
  version: privacyNotices.version,
  status: privacyNotices.status,
  effectiveDate: privacyNotices.effectiveDate,
  texts: privacyNotices.texts,
  contactName: privacyNotices.contactName,
  contactEmail: privacyNotices.contactEmail,
  contactPhone: privacyNotices.contactPhone,
  sample: privacyNotices.sample,
  publishedAt: privacyNotices.publishedAt,
};

const seeded = new Set<string>();
export async function ensureNotice(tenantId: string, tx: Tx | typeof db = db) {
  if (seeded.has(tenantId)) return;
  const [any] = await tx.select({ id: privacyNotices.id }).from(privacyNotices).where(eq(privacyNotices.tenantId, tenantId)).limit(1);
  if (!any) {
    await tx
      .insert(privacyNotices)
      .values({ tenantId, version: DEFAULT_NOTICE_VERSION, status: "active", effectiveDate: todayIST(), texts: DEFAULT_NOTICE_TEXTS, sample: true })
      .onConflictDoNothing();
  }
  seeded.add(tenantId);
}

/** The version shown at intake. */
export const getActiveNotice = cache(async (tenantId: string): Promise<NoticeRow> => {
  await ensureNotice(tenantId);
  const [row] = await db.select(cols).from(privacyNotices).where(and(eq(privacyNotices.tenantId, tenantId), eq(privacyNotices.status, "active")));
  if (!row) throw new Error("No active privacy notice"); // cannot happen after ensureNotice: one active is never retired without a successor
  return row as NoticeRow;
});

/** Every version of the tenant, newest first (draft on top). */
export async function listNotices(tenantId: string): Promise<NoticeRow[]> {
  await ensureNotice(tenantId);
  return (await db
    .select(cols)
    .from(privacyNotices)
    .where(eq(privacyNotices.tenantId, tenantId))
    .orderBy(sql`case ${privacyNotices.status} when 'draft' then 0 when 'active' then 1 else 2 end`, desc(privacyNotices.createdAt))) as NoticeRow[];
}

export type DraftInput = { texts: NoticeTexts; contactName: string | null; contactEmail: string | null; contactPhone: string | null };

/** Starts a draft from the active version (adding the contact sentence if the text has no {contact} yet). */
export async function startDraft(tx: Tx, tenantId: string, userId: string) {
  const [draft] = await tx.select({ id: privacyNotices.id }).from(privacyNotices).where(and(eq(privacyNotices.tenantId, tenantId), eq(privacyNotices.status, "draft")));
  if (draft) return draft.id;
  const [active] = await tx.select(cols).from(privacyNotices).where(and(eq(privacyNotices.tenantId, tenantId), eq(privacyNotices.status, "active")));
  const base = structuredClone((active?.texts as NoticeTexts) ?? DEFAULT_NOTICE_TEXTS);
  for (const { value: lang } of NOTICE_LANGUAGES) {
    const t = base[lang];
    if (!JSON.stringify(t).includes("{contact}")) t.paragraphs[t.paragraphs.length - 1] = `${t.paragraphs.at(-1) ?? ""} ${CONTACT_SENTENCE[lang]}`.trim();
  }
  const [row] = await tx
    .insert(privacyNotices)
    .values({
      tenantId,
      version: `draft-${crypto.randomUUID().slice(0, 8)}`, // the real label is given on publishing
      status: "draft",
      texts: base,
      contactName: active?.contactName ?? null,
      contactEmail: active?.contactEmail ?? null,
      contactPhone: active?.contactPhone ?? null,
      createdBy: userId,
    })
    .returning({ id: privacyNotices.id });
  return row.id;
}

export async function saveDraft(tx: Tx, tenantId: string, input: DraftInput) {
  const [row] = await tx
    .update(privacyNotices)
    .set({ texts: input.texts, contactName: input.contactName, contactEmail: input.contactEmail, contactPhone: input.contactPhone })
    .where(and(eq(privacyNotices.tenantId, tenantId), eq(privacyNotices.status, "draft")))
    .returning({ id: privacyNotices.id });
  if (!row) throw new FlowError("There is no draft to save. Start a new draft first.");
  return row.id;
}

/** Publishes the draft as the next version: the active one is retired (read-only), the draft becomes active. */
export async function publishDraft(tx: Tx, tenantId: string, userId: string) {
  const [draft] = await tx.select(cols).from(privacyNotices).where(and(eq(privacyNotices.tenantId, tenantId), eq(privacyNotices.status, "draft"))).for("update");
  if (!draft) throw new FlowError("There is no draft to publish.");
  const problems = noticeProblems(draft.texts as NoticeTexts);
  if (!draft.contactName?.trim() || !(draft.contactEmail?.trim() || draft.contactPhone?.trim())) {
    problems.push("Name the contact person for data requests and complaints, with an email or phone number.");
  }
  if (problems.length) throw new FlowError(problems.join(" "));
  const today = todayIST();
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(privacyNotices).where(eq(privacyNotices.tenantId, tenantId));
  const version = `v${n}-${today}`; // n counts earlier versions + this draft
  await tx.update(privacyNotices).set({ status: "retired" }).where(and(eq(privacyNotices.tenantId, tenantId), eq(privacyNotices.status, "active")));
  await tx
    .update(privacyNotices)
    .set({ status: "active", version, effectiveDate: today, publishedAt: new Date(), publishedBy: userId, sample: false })
    .where(eq(privacyNotices.id, draft.id));
  return { id: draft.id, version };
}

export async function discardDraft(tx: Tx, tenantId: string) {
  await tx.delete(privacyNotices).where(and(eq(privacyNotices.tenantId, tenantId), eq(privacyNotices.status, "draft")));
}

export const forgetSeededNotices = () => seeded.clear();
