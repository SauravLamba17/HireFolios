// Settings → Rediscovery from the database (tenant_settings). A tenant without a row for a key gets the seed value
// from settings.ts, stored as "sample" until an admin saves it.
import "server-only";
import { cache } from "react";
import { eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { tenantSettings } from "@/db/schema";
import { defaultSettings, readSetting, SETTING_KEYS, type RediscoverySettings, type SettingKey, type SettingsWithSample } from "@/lib/rediscovery/settings";
import type { Staff } from "@/lib/session";
import { audit } from "@/lib/staff";

type Q = typeof db | Tx;

/** Adds the seed value of every key this tenant has no row for (marked sample). Safe to call often. */
export async function ensureSettingDefaults(tenantId: string, q: Q = db) {
  const d = defaultSettings();
  await q
    .insert(tenantSettings)
    .values(SETTING_KEYS.map((key) => ({ tenantId, key, value: d[key] as unknown, sample: true })))
    .onConflictDoNothing();
}

async function load(tenantId: string, q: Q): Promise<SettingsWithSample> {
  let rows = await q.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId));
  if (rows.length < SETTING_KEYS.length) {
    await ensureSettingDefaults(tenantId, q);
    rows = await q.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId));
  }
  const values = defaultSettings();
  const sample: SettingsWithSample["sample"] = {};
  for (const r of rows) {
    if (!(SETTING_KEYS as string[]).includes(r.key)) continue;
    const k = r.key as SettingKey;
    (values as Record<string, unknown>)[k] = readSetting(k, r.value);
    if (r.sample) sample[k] = true;
  }
  return { values, sample };
}

/** This tenant's settings with their sample marks, once per request. */
export const getSettingsWithSample = cache((tenantId: string) => load(tenantId, db));
export const getSettings = async (tenantId: string, q?: Q): Promise<RediscoverySettings> => (q ? (await load(tenantId, q)).values : (await getSettingsWithSample(tenantId)).values);

/** Saves checked values (SettingsPatch) and clears their sample mark. Audited with the keys only. */
export async function saveSettings(tx: Tx, staff: Staff, patch: Partial<RediscoverySettings>) {
  const keys = Object.keys(patch) as SettingKey[];
  await ensureSettingDefaults(staff.tenantId, tx); // the other keys keep their sample rows
  for (const key of keys) {
    await tx
      .insert(tenantSettings)
      .values({ tenantId: staff.tenantId, key, value: patch[key] as unknown, sample: false, updatedBy: staff.id })
      .onConflictDoUpdate({ target: [tenantSettings.tenantId, tenantSettings.key], set: { value: sql`excluded.value`, sample: false, updatedBy: staff.id, updatedAt: new Date() } });
  }
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "settings.update", entityType: "tenant", entityId: staff.tenantId, meta: { keys: keys.join(","), count: keys.length } });
}
