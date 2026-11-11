import { isUuid } from "@/db";
import { FlowError, NotFoundError } from "@/lib/flow";
import { accessZip } from "@/lib/privacy";
import { requireStaffApi } from "@/lib/session";

// Access request → ZIP (data.json + photo / CV files) for HR to hand to the person. Audited.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { staff, error } = await requireStaffApi(req, "privacy");
  if (error) return error;
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const { zip, name } = await accessZip(staff, id);
    return new Response(new Uint8Array(zip), {
      headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch (e) {
    if (e instanceof FlowError) return Response.json({ error: e.message }, { status: e instanceof NotFoundError ? 404 : 400 });
    throw e;
  }
}
