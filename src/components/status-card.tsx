import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { systemStatus } from "@/lib/health";
import { formatDateTimeIST } from "@/lib/ist";

const DAY = 24 * 60 * 60 * 1000;

/** Admin: is the office server healthy? Database, disk space for photos/CVs, last backup, last automatic deletion run. */
export async function StatusCard({ tenantId }: { tenantId: string }) {
  const [s, [purge]] = await Promise.all([
    systemStatus(),
    db
      .select({ at: auditLog.createdAt, meta: auditLog.meta })
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, "retention.purge")))
      .orderBy(desc(auditLog.createdAt))
      .limit(1),
  ]);
  const backupAge = s.lastBackupAt ? Date.now() - new Date(s.lastBackupAt).getTime() : null;
  const items: { label: string; value: string; ok: boolean }[] = [
    { label: "Database", value: s.database ? "Connected" : "Not reachable", ok: s.database },
    {
      label: "Free disk (photos & CVs)",
      value: s.uploads.freeGB === null ? (s.uploads.configured ? "Folder not found" : "UPLOAD_DIR not set") : `${s.uploads.freeGB} GB`,
      ok: s.uploads.freeGB !== null && s.uploads.freeGB >= 5,
    },
    {
      label: "Last backup",
      value: s.lastBackupAt ? formatDateTimeIST(new Date(s.lastBackupAt)) : "No backup recorded",
      ok: backupAge !== null && backupAge < 2 * DAY,
    },
    {
      label: "Last automatic deletion",
      value: purge ? `${formatDateTimeIST(purge.at)} (${purge.meta?.candidates ?? 0} candidates, ${purge.meta?.photos ?? 0} photos)` : "Not run yet",
      ok: Boolean(purge) && Date.now() - purge.at.getTime() < DAY,
    },
  ];
  return (
    <section className="card p-4" aria-labelledby="status-h">
      <h2 id="status-h" className="mb-3 text-base font-semibold">Server status <span className="font-normal text-slate-500">· version {s.version}</span></h2>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((i) => (
          <div key={i.label} className={`rounded-lg p-3 ${i.ok ? "bg-green-50" : "bg-amber-50"}`} data-testid={`status-${i.label}`}>
            <dt className="text-sm text-slate-600">{i.label}</dt>
            <dd className={`font-medium ${i.ok ? "text-green-900" : "text-amber-950"}`}>
              <span aria-hidden="true">{i.ok ? "✓ " : "! "}</span>
              {i.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
