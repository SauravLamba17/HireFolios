import { z } from "zod";
import { isUuid } from "@/db";
import { act, badRequest } from "@/lib/api";
import { BaseDetails, firstIssue, Mobile } from "@/lib/intake";
import { correctCandidate } from "@/lib/privacy";
import { requireStaffApi } from "@/lib/session";

// Same rules as intake for these fields (18+, real date, valid email, Indian mobile).
const Correction = z.object({
  fullName: BaseDetails.shape.fullName,
  mobile: Mobile,
  email: BaseDetails.shape.email,
  city: BaseDetails.shape.city,
  dateOfBirth: BaseDetails.shape.dateOfBirth,
});

// Correction requests (admin, HR): fix a candidate's core details. Audited with field names only.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { staff, error } = await requireStaffApi(req, "privacy");
  if (error) return error;
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const parsed = Correction.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  return act(staff, (tx) => correctCandidate(tx, staff, id, parsed.data), "Another candidate already has this mobile number.");
}
