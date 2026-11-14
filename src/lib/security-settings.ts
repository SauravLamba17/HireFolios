// Settings → Security (admin): the office IP allow-list, per tenant, stored in tenant_settings under "security.*".
// Off by default. When on, staff may sign in only from the listed addresses, and the lobby TV (display role) may use
// the app only from them. IP_ALLOWLIST_OFF=1 in the server's settings file switches it off in an emergency.
import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { tenantSettings, users } from "@/db/schema";
import { config } from "@/lib/config";
import { ipAllowed } from "@/lib/net";
import type { Staff } from "@/lib/session";
import { audit } from "@/lib/staff";

export type AllowList = { on: boolean; entries: string[] };
const KEYS = { on: "security.ip_allowlist_on", entries: "security.ip_allowlist" } as const;

export async function getAllowList(tenantId: string, q: typeof db | Tx = db): Promise<AllowList> {
  const rows = await q
    .select({ key: tenantSettings.key, value: tenantSettings.value })
    .from(tenantSettings)
    .where(and(eq(tenantSettings.tenantId, tenantId), inArray(tenantSettings.key, [KEYS.on, KEYS.entries])));
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const entries = get(KEYS.entries);
  return { on: get(KEYS.on) === true, entries: Array.isArray(entries) ? entries.filter((e): e is string => typeof e === "string") : [] };
}

export async function saveAllowList(tx: Tx, staff: Staff, list: AllowList) {
  for (const [key, value] of [[KEYS.on, list.on], [KEYS.entries, list.entries]] as const) {
    await tx
      .insert(tenantSettings)
      .values({ tenantId: staff.tenantId, key, value, sample: false, updatedBy: staff.id })
      .onConflictDoUpdate({ target: [tenantSettings.tenantId, tenantSettings.key], set: { value: sql`excluded.value`, sample: false, updatedBy: staff.id, updatedAt: new Date() } });
  }
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "security.allowlist", entityType: "tenant", entityId: staff.tenantId, meta: { on: list.on, entries: list.entries.length } });
}

/** May this address be used by this tenant's staff? (always yes while the list is off or IP_ALLOWLIST_OFF=1) */
export async function addressAllowed(tenantId: string, ip: string | null) {
  if (config().IP_ALLOWLIST_OFF === "1") return true;
  const list = await getAllowList(tenantId);
  return !list.on || ipAllowed(ip, list.entries);
}

/** The tenant of the account with this email (for the sign-in check), or null. */
export async function tenantOfEmail(email: string) {
  const [u] = await db.select({ id: users.id, tenantId: users.tenantId, lockedUntil: users.lockedUntil }).from(users).where(eq(users.email, email.trim().toLowerCase()));
  return u ?? null;
}
