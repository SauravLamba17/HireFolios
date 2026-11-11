// Audit log viewer / CSV: same filters for both (date range IST, action, actor). Tenant always first.
import "server-only";
import { and, desc, eq, gte, isNull, lt, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { todayIST } from "@/lib/ist";
import { parseRange } from "@/lib/reports";

export const AUDIT_PAGE = 100;
export const AUDIT_CSV_MAX = 50_000;

export type AuditFilters = { from: string; to: string; action: string | null; actor: string | null; page: number };

export function parseAuditFilters(q: Record<string, string | undefined>): AuditFilters {
  const { from, to } = parseRange({ from: q.from, to: q.to }, todayIST());
  const action = q.action && /^[a-z_.]{1,60}$/.test(q.action) ? q.action : null;
  const actor = q.actor && /^[\w-]{1,80}$/.test(q.actor) ? q.actor : null; // a user id, or "system"
  const page = Math.min(Math.max(1, Number.parseInt(q.page ?? "1", 10) || 1), 10_000);
  return { from, to, action, actor, page };
}

export function auditWhere(tenantId: string, f: AuditFilters): SQL {
  const start = new Date(`${f.from}T00:00:00+05:30`);
  const end = new Date(new Date(`${f.to}T00:00:00+05:30`).getTime() + 24 * 60 * 60 * 1000);
  const parts: (SQL | undefined)[] = [eq(auditLog.tenantId, tenantId), gte(auditLog.createdAt, start), lt(auditLog.createdAt, end)];
  if (f.action) parts.push(eq(auditLog.action, f.action));
  if (f.actor === "system") parts.push(isNull(auditLog.actorUserId));
  else if (f.actor) parts.push(eq(auditLog.actorUserId, f.actor));
  return and(...parts)!;
}

export function auditRows(tenantId: string, f: AuditFilters, limit: number, offset: number) {
  return db
    .select({ id: auditLog.id, at: auditLog.createdAt, action: auditLog.action, actor: users.name, actorId: auditLog.actorUserId, entityType: auditLog.entityType, entityId: auditLog.entityId, meta: auditLog.meta })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(auditWhere(tenantId, f))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit)
    .offset(offset);
}
