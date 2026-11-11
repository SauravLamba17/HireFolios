import { z } from "zod";
import { db, isUuid } from "@/db";
import { act, badRequest } from "@/lib/api";
import { FlowError, NotFoundError } from "@/lib/flow";
import { firstIssue, Mobile } from "@/lib/intake";
import { todayIST } from "@/lib/ist";
import { publish } from "@/lib/live";
import { createRequest, eraseForRequest, updateRequest } from "@/lib/privacy";
import { unlinkAll } from "@/lib/purge";
import { requireStaffApi } from "@/lib/session";

const id = z.string().refine(isUuid, "Not found");
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "Too long")
    .nullable()
    .transform((v) => v || null);
const Action = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    kind: z.enum(["access", "correction", "erasure", "grievance"], "Choose the kind of request"),
    mobile: z.union([z.literal(""), Mobile]).nullable().transform((v) => v || null),
    requesterName: z.string("Enter who asked").trim().min(2, "Enter who asked").max(100),
    requesterContact: optText(200),
    receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date received").refine((d) => d <= todayIST(), "The date received can't be in the future"),
    notes: optText(2000),
  }),
  z.object({ action: z.literal("update"), id, status: z.enum(["open", "in_progress", "completed", "rejected"]), resolution: optText(2000) }),
  z.object({ action: z.literal("erase"), id }),
]);

// Rights requests (admin, HR): log, update, and erase now. Access downloads are GET /api/privacy/[id]/export.
export async function POST(req: Request) {
  const { staff, error } = await requireStaffApi(req, "privacy");
  if (error) return error;
  const parsed = Action.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const a = parsed.data;
  if (a.action === "erase") {
    try {
      const keys = await db.transaction((tx) => eraseForRequest(tx, staff, a.id));
      const files = await unlinkAll(keys); // only after the rows are gone for good
      publish(staff.tenantId);
      return Response.json({ ok: true, result: { files } });
    } catch (e) {
      if (e instanceof FlowError) return Response.json({ error: e.message }, { status: e instanceof NotFoundError ? 404 : 400 });
      throw e;
    }
  }
  return act(staff, async (tx): Promise<unknown> => (a.action === "create" ? createRequest(tx, staff, a) : updateRequest(tx, staff, a.id, a)));
}
