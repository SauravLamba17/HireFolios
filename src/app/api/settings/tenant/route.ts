import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { applications, tenants } from "@/db/schema";
import { act, badRequest } from "@/lib/api";
import { FlowError, type Outcome } from "@/lib/flow";
import { firstIssue } from "@/lib/intake";
import { recalculatedDates, retentionProblem } from "@/lib/retention";
import { requireStaffApi } from "@/lib/session";
import { audit } from "@/lib/staff";

const Body = z.union([
  z.object({
    avgInterviewMinutes: z.int("Minutes must be a whole number").min(1, "At least 1 minute").max(240, "At most 240 minutes").nullable(),
  }),
  z.object({
    retention: z.object({
      cooldownDays: z.int("Whole days only"),
      photoRetentionDays: z.int("Whole days only"),
      dataRetentionDays: z.int("Whole days only"),
      recalculateExisting: z.boolean(),
    }),
  }),
]);

// Settings (admin): average interview minutes, or retention days (cooldown / photos / data).
export async function PATCH(req: Request) {
  const { staff, error } = await requireStaffApi(req, "settings");
  if (error) return error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const body = parsed.data;
  const tenantId = staff.tenantId;
  return act(staff, async (tx) => {
    if ("avgInterviewMinutes" in body) {
      await tx.update(tenants).set({ avgInterviewMinutes: body.avgInterviewMinutes }).where(eq(tenants.id, tenantId));
      await audit(tx, { tenantId, actorUserId: staff.id, action: "tenant.update", entityType: "tenant", entityId: tenantId, meta: { avgInterviewMinutes: body.avgInterviewMinutes } });
      return;
    }
    const r = body.retention;
    const problem = retentionProblem(r);
    if (problem) throw new FlowError(problem);
    const [before] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for("update");
    await tx
      .update(tenants)
      .set({ cooldownDays: r.cooldownDays, photoRetentionDays: r.photoRetentionDays, dataRetentionDays: r.dataRetentionDays })
      .where(eq(tenants.id, tenantId));
    let recalculated = 0;
    if (r.recalculateExisting) {
      // Every decided visit gets purge dates from its decision time and the new days (talent pool / joined stay empty).
      const decided = await tx.execute<{ id: string; outcome: Outcome; decided_at: string; pool: boolean }>(sql`
        select a.id, a.outcome, a.decided_at,
          coalesce((select k.talent_pool and k.withdrawn_at is null from consents k
                    where k.candidate_id = a.candidate_id order by k.accepted_at desc limit 1), false) as pool
        from applications a where a.tenant_id = ${tenantId} and a.decided_at is not null`);
      for (const a of decided) {
        const dates = recalculatedDates({ outcome: a.outcome, decidedAt: new Date(a.decided_at) }, r, a.pool);
        await tx.update(applications).set(dates).where(eq(applications.id, a.id));
        recalculated++;
      }
    }
    await audit(tx, {
      tenantId,
      actorUserId: staff.id,
      action: "tenant.retention",
      entityType: "tenant",
      entityId: tenantId,
      meta: {
        cooldownDays: r.cooldownDays,
        photoRetentionDays: r.photoRetentionDays,
        dataRetentionDays: r.dataRetentionDays,
        previousPhotoDays: before.photoRetentionDays,
        previousDataDays: before.dataRetentionDays,
        recalculated,
      },
    });
    return { recalculated };
  });
}
