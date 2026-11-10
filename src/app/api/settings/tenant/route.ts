import { eq } from "drizzle-orm";
import { z } from "zod";
import { tenants } from "@/db/schema";
import { act, badRequest } from "@/lib/api";
import { firstIssue } from "@/lib/intake";
import { requireStaffApi } from "@/lib/session";
import { audit } from "@/lib/staff";

const Body = z.object({
  avgInterviewMinutes: z.int("Minutes must be a whole number").min(1, "At least 1 minute").max(240, "At most 240 minutes").nullable(),
});

// Settings → average interview minutes (only used for wait estimates until today has real timings).
export async function PATCH(req: Request) {
  const { staff, error } = await requireStaffApi(req, "settings");
  if (error) return error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  return act(staff, async (tx) => {
    await tx.update(tenants).set({ avgInterviewMinutes: parsed.data.avgInterviewMinutes }).where(eq(tenants.id, staff.tenantId));
    await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "tenant.update", entityType: "tenant", entityId: staff.tenantId, meta: { avgInterviewMinutes: parsed.data.avgInterviewMinutes } });
  });
}
