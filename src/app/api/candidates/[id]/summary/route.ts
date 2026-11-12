import { and, eq } from "drizzle-orm";
import { db, isUuid } from "@/db";
import { candidates } from "@/db/schema";
import { canViewCandidate } from "@/lib/access";
import { summaries } from "@/lib/rediscovery/data";
import { can, requireStaffApi } from "@/lib/session";

// Hiring summary of one candidate (docs/REDISCOVERY.md A8): HR, admin, manager; interviewers only for candidates
// they were called to interview. Other tenants' ids answer 404 like missing ones.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { staff, error } = await requireStaffApi(req);
  if (error) return error;
  const { id } = await params;
  const notFound = Response.json({ error: "Not found" }, { status: 404 });
  if (!isUuid(id) || !(await canViewCandidate(staff, id))) return notFound;
  const [c] = await db.select({ id: candidates.id }).from(candidates).where(and(eq(candidates.id, id), eq(candidates.tenantId, staff.tenantId)));
  if (!c) return notFound;
  const s = (await summaries(staff.tenantId, [id], undefined, { hideCost: !can(staff.role, "rediscovery") })).get(id)!;
  const { history: _history, ...summary } = s; // eslint-disable-line @typescript-eslint/no-unused-vars
  return Response.json(summary, { headers: { "cache-control": "no-store" } });
}
