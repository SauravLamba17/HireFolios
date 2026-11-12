// Pick-lists per tenant from the database (option_items). A tenant without any item for a list gets the starting
// list from src/lib/options.ts (marked "sample" until an admin edits it): new tenants, upgraded installs, test tenants.
import "server-only";
import { cache } from "react";
import { and, asc, eq } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { optionItems } from "@/db/schema";
import { defaultListItems, LIST_KEYS, type ListKey, type OptionLists } from "@/lib/lists";

const seeded = new Set<string>(); // tenants whose lists are known to exist (this process)

/** Adds the starting list for every list that has no items yet in this tenant. Safe to call often and concurrently. */
export async function ensureListDefaults(tenantId: string, tx: Tx | typeof db = db) {
  if (seeded.has(tenantId)) return;
  const have = new Set((await tx.selectDistinct({ list: optionItems.list }).from(optionItems).where(eq(optionItems.tenantId, tenantId))).map((r) => r.list));
  const defaults = defaultListItems();
  const rows = LIST_KEYS.filter((k) => !have.has(k)).flatMap((list) =>
    defaults[list].map((d, i) => ({ tenantId, list, label: d.label, days: d.days, position: i + 1, sample: true })),
  );
  if (rows.length) await tx.insert(optionItems).values(rows).onConflictDoNothing();
  seeded.add(tenantId);
}

/** All lists of a tenant (active and retired items), cached for one request. */
export const getOptionLists = cache(async (tenantId: string): Promise<OptionLists> => {
  await ensureListDefaults(tenantId);
  const rows = await db
    .select({ id: optionItems.id, list: optionItems.list, label: optionItems.label, days: optionItems.days, active: optionItems.active, sample: optionItems.sample })
    .from(optionItems)
    .where(eq(optionItems.tenantId, tenantId))
    .orderBy(asc(optionItems.list), asc(optionItems.position), asc(optionItems.createdAt));
  const out = Object.fromEntries(LIST_KEYS.map((k) => [k, []])) as unknown as OptionLists;
  for (const { list, ...item } of rows) out[list].push(item);
  return out;
});

/** The items of one list in a write transaction (for the Settings API). */
export function listRows(tx: Tx, tenantId: string, list: ListKey) {
  return tx
    .select({ id: optionItems.id, position: optionItems.position })
    .from(optionItems)
    .where(and(eq(optionItems.tenantId, tenantId), eq(optionItems.list, list)))
    .orderBy(asc(optionItems.position), asc(optionItems.createdAt));
}

/** Test hook: forget which tenants were seeded (a test may delete their rows). */
export const forgetSeededLists = () => seeded.clear();
