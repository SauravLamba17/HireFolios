import { AUDIT_CSV_MAX, auditRows, parseAuditFilters } from "@/lib/audit-query";
import { toCsv } from "@/lib/exports";
import { requireStaffApi } from "@/lib/session";
import { audit } from "@/lib/staff";
import { db } from "@/db";

// CSV of the audit log with the viewer's filters (admin). The export itself is audited.
export async function GET(req: Request) {
  const { staff, error } = await requireStaffApi(req, "audit");
  if (error) return error;
  const f = parseAuditFilters(Object.fromEntries(new URL(req.url).searchParams));
  const rows = await auditRows(staff.tenantId, f, AUDIT_CSV_MAX, 0);
  const csv = toCsv(
    [
      { header: "When (UTC)", width: 0, value: (r: (typeof rows)[number]) => r.at.toISOString() },
      { header: "Action", width: 0, value: (r) => r.action },
      { header: "Actor id", width: 0, value: (r) => r.actorId ?? "system" },
      { header: "Entity", width: 0, value: (r) => r.entityType },
      { header: "Entity id", width: 0, value: (r) => r.entityId },
      { header: "Details", width: 0, value: (r) => (r.meta ? JSON.stringify(r.meta) : "") },
    ],
    rows,
  );
  await audit(db, { tenantId: staff.tenantId, actorUserId: staff.id, action: "export.download", entityType: "audit_log", entityId: null, meta: { kind: "audit", rows: rows.length } });
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-${f.from}-to-${f.to}.csv"`, "cache-control": "no-store" },
  });
}
