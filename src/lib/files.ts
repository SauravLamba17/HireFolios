// Candidate file helpers: type sniffing, storage keys (<tenant>/<candidate>/<file>), checksums. The files themselves
// live in storage (src/lib/storage.ts: UPLOAD_DIR or S3), never inside public/; served only by GET /api/files/[id].
import "server-only";
import { createHash } from "node:crypto";
import path from "node:path";

export const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export type FileType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | typeof DOCX;
const EXT: Record<FileType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf", [DOCX]: "docx" };

/**
 * Absolute folder for uploads, or null when UPLOAD_DIR is unset or relative.
 * It must be absolute: the production server changes its working directory to
 * .next/standalone, which `npm run build` wipes.
 */
export function uploadRoot(): string | null {
  const dir = process.env.UPLOAD_DIR?.trim();
  return dir && path.isAbsolute(dir) ? path.resolve(dir) : null;
}

/** Real type from the first bytes (the browser's claimed type is not trusted). */
export function sniffType(b: Uint8Array): FileType | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  // Word .docx is a ZIP whose entries include word/document.xml and [Content_Types].xml (names are stored as
  // plain text). Other ZIPs (.xlsx, .pptx, plain archives) are refused. Stored as-is and only ever downloaded (never shown inline, opened or run).
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    const text = Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("latin1");
    if (text.includes("word/document.xml") && text.includes("[Content_Types].xml")) return DOCX;
  }
  return null;
}

export const storageKey = (tenantId: string, candidateId: string, fileId: string, type: FileType) =>
  `${tenantId}/${candidateId}/${fileId}.${EXT[type]}`;

export const extensionOf = (type: string) => EXT[type as FileType] ?? "bin";


export const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
