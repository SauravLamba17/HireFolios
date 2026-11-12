import { z } from "zod";
import { isUuid } from "@/db";
import { act, badRequest } from "@/lib/api";
import { firstIssue } from "@/lib/intake";
import { setPushStatus } from "@/lib/rediscovery/actions";
import { PUSH_STATUSES, type PushStatus } from "@/lib/rediscovery/rank";
import { requireStaffApi } from "@/lib/session";

const Body = z.object({
  action: z.literal("status"),
  memberId: z.string().refine(isUuid, "Not on this push"),
  status: z.enum(Object.keys(PUSH_STATUSES) as [PushStatus, ...PushStatus[]], "Choose a status"),
});

// Per-person status on a hiring push (audited).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { staff, error } = await requireStaffApi(req, "rediscovery");
  if (error) return error;
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  return act(staff, (tx) => setPushStatus(tx, staff, id, { memberId: parsed.data.memberId, status: parsed.data.status }));
}
