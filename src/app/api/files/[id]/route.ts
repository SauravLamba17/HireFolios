import { and, eq, isNull } from "drizzle-orm";
import { db, isUuid } from "@/db";
import { candidateFiles } from "@/db/schema";
import { extensionOf, readFileUnder, uploadRoot } from "@/lib/files";
import { requireStaffApi } from "@/lib/session";

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

// Candidate photos and CVs: signed-in staff of the same tenant only. Another tenant's id is a plain 404.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { staff, error } = await requireStaffApi(req);
  if (error) return error;
  const { id } = await params;
  const root = uploadRoot();
  if (!isUuid(id) || !root) return notFound();

  const [f] = await db
    .select({ key: candidateFiles.storageKey, type: candidateFiles.mimeType, kind: candidateFiles.kind })
    .from(candidateFiles)
    .where(and(eq(candidateFiles.id, id), eq(candidateFiles.tenantId, staff.tenantId), isNull(candidateFiles.deletedAt)));
  if (!f) return notFound();

  const data = await readFileUnder(root, f.key).catch(() => null);
  if (!data) return notFound();
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": f.type,
      "content-length": String(data.byteLength),
      "content-disposition": `inline; filename="${f.kind}-${id}.${extensionOf(f.type)}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=3600",
      vary: "Cookie",
    },
  });
}
