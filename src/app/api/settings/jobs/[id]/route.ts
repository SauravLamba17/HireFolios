import { and, eq } from "drizzle-orm";
import { db, isUniqueViolation, isUuid } from "@/db";
import { jobs } from "@/db/schema";
import { makeJobInput } from "@/lib/jobs";
import { getOptionLists } from "@/lib/lists-db";
import { requireStaffApi } from "@/lib/session";
import { audit } from "@/lib/staff";

const FIELDS = ["title", "status", "openings", "minExperienceYears", "maxExperienceYears", "requiredCertifications"] as const;

// Saving a job also confirms it (clears the "sample" flag set by the seed).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { staff, error } = await requireStaffApi(req, "settings");
  if (error) return error;
  const { id } = await params;
  const certs = (await getOptionLists(staff.tenantId)).certification.map((c) => c.label);
  const parsed = makeJobInput(certs).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  if (!isUuid(id)) return Response.json({ error: "Job not found" }, { status: 404 });
  const j = parsed.data;

  try {
    const found = await db.transaction(async (tx) => {
      const sameTenant = and(eq(jobs.id, id), eq(jobs.tenantId, staff.tenantId));
      const [cur] = await tx.select().from(jobs).where(sameTenant).for("update");
      if (!cur) return false;
      const changed = FIELDS.filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(j[k]));
      if (changed.length === 0 && !cur.sample) return true;
      await tx.update(jobs).set({ ...j, active: j.status === "open", sample: false }).where(sameTenant);
      await audit(tx, {
        tenantId: staff.tenantId,
        actorUserId: staff.id,
        action: "job.update",
        entityType: "job",
        entityId: id,
        meta: { changed: changed.join(","), status: j.status, confirmedSample: cur.sample },
      });
      return true;
    });
    if (!found) return Response.json({ error: "Job not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (e) {
    if (isUniqueViolation(e, "jobs_tenant_title_uq")) return Response.json({ error: "A job with this title already exists." }, { status: 409 });
    throw e;
  }
}
