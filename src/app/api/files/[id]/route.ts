import { and, eq, isNull } from "drizzle-orm";
import { db, isUuid } from "@/db";
import { candidateFiles } from "@/db/schema";
import { DOCX, extensionOf } from "@/lib/files";
import { canViewCandidate } from "@/lib/access";
import { requireStaffApi } from "@/lib/session";
import { storage } from "@/lib/storage";

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

// Candidate photos and CVs: staff of the same tenant who may see that candidate (interviewers: only
// candidates they interviewed; the lobby TV login: none). Anything else is a plain 404.
// The file comes from storage (src/lib/storage.ts): streamed by the app, or — S3 with S3_SIGNED_URLS=on — a redirect
// to a signed URL that expires after S3_SIGNED_URL_SECONDS. Either way only after these checks.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { staff, error } = await requireStaffApi(req);
  if (error) return error;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const [f] = await db
    .select({ key: candidateFiles.storageKey, type: candidateFiles.mimeType, kind: candidateFiles.kind, candidateId: candidateFiles.candidateId })
    .from(candidateFiles)
    .where(and(eq(candidateFiles.id, id), eq(candidateFiles.tenantId, staff.tenantId), isNull(candidateFiles.deletedAt)));
  if (!f || !(await canViewCandidate(staff, f.candidateId))) return notFound();

  // Word files are always downloaded, never shown in the browser.
  const disposition = `${f.type === DOCX ? "attachment" : "inline"}; filename="${f.kind}-${id}.${extensionOf(f.type)}"`;
  const store = storage();
  const signed = await store.signedUrl(f.key, { contentType: f.type, disposition });
  // no-store: the signed link is never cached. (No Referer reaches S3: the page's own policy is same-origin.)
  if (signed) return new Response(null, { status: 302, headers: { location: signed, "cache-control": "no-store" } });

  const file = await store.stream(f.key).catch(() => null);
  if (!file) return notFound();
  return new Response(file.body, {
    headers: {
      "content-type": f.type,
      ...(file.size !== null ? { "content-length": String(file.size) } : {}),
      "content-disposition": disposition,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=3600",
      vary: "Cookie",
    },
  });
}
