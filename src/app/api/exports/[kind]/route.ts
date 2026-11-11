import { sql } from "drizzle-orm";
import { db } from "@/db";
import { dataExports } from "@/db/schema";
import { parseFilters, searchCandidates } from "@/lib/candidate-search";
import { CANDIDATE_COLUMNS, DRIVE_COLUMNS, JOINED_COLUMNS, sheet, toCsv, toXlsx, type DriveExportRow, type JoinedExportRow } from "@/lib/exports";
import { formatDateTimeIST, todayIST } from "@/lib/ist";
import { OUTCOME_LABELS } from "@/lib/options";
import { requireStaffApi } from "@/lib/session";
import { audit } from "@/lib/staff";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const time = (v: string | Date | null) => (v ? formatDateTimeIST(new Date(v)).split(", ").pop()! : null);

// Excel / CSV downloads for admin and HR: candidates (current list filters), a drive day, joined employees.
// Every export is recorded in the exports table and the audit log (kind, filters' keys, row count; no personal data).
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { staff, error } = await requireStaffApi(req, "export");
  if (error) return error;
  const { kind } = await params;
  const url = new URL(req.url);
  const q = Object.fromEntries(url.searchParams);
  const tenantId = staff.tenantId;
  let body: Uint8Array | string;
  let rows = 0;
  let filename = "";
  let type = XLSX;
  let filters: Record<string, string> = {};

  if (kind === "candidates") {
    const f = parseFilters(q);
    const { rows: list } = await searchCandidates(f, tenantId, { all: true });
    rows = list.length;
    filters = Object.fromEntries(Object.entries(f).filter(([k, v]) => k !== "page" && v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
    body = await toXlsx([sheet("Candidates", CANDIDATE_COLUMNS, list)]);
    filename = `candidates-${todayIST()}.xlsx`;
  } else if (kind === "drive") {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(q.date ?? "") ? q.date! : todayIST();
    filters = { date };
    const list = [
      ...(await db.execute<DriveExportRow & { created_at: string; decided: string | null }>(sql`
        select a.token, c.full_name, c.mobile, j.title as job, s.name as stage, a.outcome, a.reject_reason,
               a.created_at, a.decided_at as decided,
               (select count(*)::int from scorecards sc where sc.application_id = a.id) as rounds
        from applications a
        join candidates c on c.id = a.candidate_id
        join jobs j on j.id = a.job_id
        join stages s on s.id = a.current_stage_id
        where a.tenant_id = ${tenantId} and a.token_date = ${date}
        order by a.created_at`)),
    ].map((r) => ({ ...r, registered_at: time(r.created_at)!, decided_at: time(r.decided) }));
    rows = list.length;
    const count = (o: string) => list.filter((r) => r.outcome === o).length;
    const summary = [
      { k: "Day", v: date },
      { k: "Walk-ins", v: String(list.length) },
      ...Object.keys(OUTCOME_LABELS).map((o) => ({ k: OUTCOME_LABELS[o], v: String(count(o)) })),
      { k: "Exported at (IST)", v: formatDateTimeIST(new Date()) },
    ];
    body = await toXlsx([
      { name: "Summary", headers: ["", date], widths: [22, 22], rows: summary.map((r) => [r.k, r.v]) },
      sheet("Candidates", DRIVE_COLUMNS, list),
    ]);
    filename = `drive-${date}.xlsx`;
  } else if (kind === "joined") {
    const list = [
      ...(await db.execute<JoinedExportRow>(sql`
        select c.full_name, c.mobile, c.email, c.date_of_birth::text, j.title as job, a.joined_on::text, a.offered_ctc
        from applications a join candidates c on c.id = a.candidate_id join jobs j on j.id = a.job_id
        where a.tenant_id = ${tenantId} and a.outcome = 'joined'
        order by a.joined_on desc nulls last`)),
    ];
    rows = list.length;
    const csv = q.format === "csv";
    filters = { format: csv ? "csv" : "xlsx" };
    body = csv ? toCsv(JOINED_COLUMNS, list) : await toXlsx([sheet("Joined", JOINED_COLUMNS, list)]);
    type = csv ? "text/csv; charset=utf-8" : XLSX;
    filename = `joined-employees-${todayIST()}.${csv ? "csv" : "xlsx"}`;
  } else {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(dataExports)
      .values({ tenantId, requestedBy: staff.id, kind, params: { filters: Object.keys(filters) }, status: "done", rowCount: rows, completedAt: new Date() })
      .returning({ id: dataExports.id });
    await audit(tx, { tenantId, actorUserId: staff.id, action: "export.download", entityType: "export", entityId: row.id, meta: { kind, rows } });
  });
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "content-type": type,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
