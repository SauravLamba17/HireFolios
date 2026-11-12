import { db, isUniqueViolation } from "@/db";
import { jobs } from "@/db/schema";
import { makeJobInput } from "@/lib/jobs";
import { getOptionLists } from "@/lib/lists-db";
import { requireStaffApi } from "@/lib/session";
import { audit } from "@/lib/staff";

export async function POST(req: Request) {
  const { staff, error } = await requireStaffApi(req, "settings");
  if (error) return error;
  const certs = (await getOptionLists(staff.tenantId)).certification.map((c) => c.label);
  const parsed = makeJobInput(certs).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const j = parsed.data;
  try {
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(jobs)
        .values({ ...j, tenantId: staff.tenantId, active: j.status === "open" })
        .returning({ id: jobs.id });
      await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "job.create", entityType: "job", entityId: row.id, meta: { status: j.status } });
      return row.id;
    });
    return Response.json({ id }, { status: 201 });
  } catch (e) {
    if (isUniqueViolation(e, "jobs_tenant_title_uq")) return Response.json({ error: "A job with this title already exists." }, { status: 409 });
    throw e;
  }
}
