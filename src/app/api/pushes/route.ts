import { z } from "zod";
import { act, badRequest } from "@/lib/api";
import { firstIssue } from "@/lib/intake";
import { createPush } from "@/lib/rediscovery/actions";
import { BulkForm } from "@/lib/rediscovery/pool";
import { requireStaffApi } from "@/lib/session";

const Body = z.object({ name: z.string("Name the push").trim().min(3, "Name the push (at least 3 characters)").max(100, "Name is too long"), criteria: z.record(z.string(), z.unknown()) });

// Save a bulk hiring list as a named push (HR, manager, admin). The list is rebuilt on the server from the criteria.
export async function POST(req: Request) {
  const { staff, error } = await requireStaffApi(req, "rediscovery");
  if (error) return error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  return act(staff, (tx) => createPush(tx, staff, { name: parsed.data.name, criteria: BulkForm.parse(parsed.data.criteria) }), "A push with that name already exists.");
}
