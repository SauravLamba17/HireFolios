import { quickLook } from "@/lib/rediscovery/quicklook";
import { requireStaffApi } from "@/lib/session";

// Header quick-look (HR, manager, admin). Read-only, this tenant only; no audit row per keystroke (opening a profile is audited).
export async function GET(req: Request) {
  const { staff, error } = await requireStaffApi(req, "rediscovery");
  if (error) return error;
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100);
  return Response.json({ rows: await quickLook(staff.tenantId, q) }, { headers: { "cache-control": "no-store" } });
}
