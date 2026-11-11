import { and, eq, isNull } from "drizzle-orm";
import { db, isUuid } from "@/db";
import { candidateFiles } from "@/db/schema";
import { DOCX, extensionOf, readFileUnder, uploadRoot } from "@/lib/files";
import { canViewCandidate } from "@/lib/access";
import { requireStaffApi } from "@/lib/session";

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

// Candidate photos and CVs: staff of the same tenant who may see that candidate (interviewers: only
// candidates they interviewed; the lobby TV login: none). Anything else is a plain 404.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { staff, error } = await requireStaffApi(req);
  if (error) return error;
  const { id } = await params;
  const root = uploadRoot();
  if (!isUuid(id) || !root) return notFound();

  const [f] = await db
    .select({ key: candidateFiles.storageKey, type: candidateFiles.mimeType, kind: candidateFiles.kind, candidateId: candidateFiles.candidateId })
    .from(candidateFiles)
    .where(and(eq(candidateFiles.id, id), eq(candidateFiles.tenantId, staff.tenantId), isNull(candidateFiles.deletedAt)));
  if (!f || !(await canViewCandidate(staff, f.candidateId))) return notFound();

  const data = await readFileUnder(root, f.key).catch(() => null);
  if (!data) return notFound();
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": f.type,
      "content-length": String(data.byteLength),
      // Word files are always downloaded, never shown in the browser.
      "content-disposition": `${f.type === DOCX ? "attachment" : "inline"}; filename="${f.kind}-${id}.${extensionOf(f.type)}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=3600",
      vary: "Cookie",
    },
  });
}
