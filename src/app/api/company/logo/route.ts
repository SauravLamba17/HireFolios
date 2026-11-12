import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { readFileUnder, uploadRoot } from "@/lib/files";
import { requireStaffApi } from "@/lib/session";

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

// The company logo (Settings → Company) for the header, the lobby TV and exports: any signed-in staff member of the
// same tenant, the TV login included. Never public.
export async function GET(req: Request) {
  const { staff, error } = await requireStaffApi(req);
  if (error) return error;
  const root = uploadRoot();
  const [t] = await db.select({ key: tenants.logoKey, type: tenants.logoType }).from(tenants).where(eq(tenants.id, staff.tenantId));
  if (!root || !t?.key || !t.type) return notFound();
  const data = await readFileUnder(root, t.key).catch(() => null);
  if (!data) return notFound();
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": t.type,
      "content-length": String(data.byteLength),
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
      "cache-control": "private, max-age=86400", // the URL carries ?v=<time of change>
      vary: "Cookie",
    },
  });
}
