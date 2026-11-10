// Candidate files on disk, under UPLOAD_DIR/<tenant>/<candidate>/. Never inside public/;
// served only by GET /api/files/[id] after a tenant check.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type FileType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
const EXT: Record<FileType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

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
  return null;
}

export const storageKey = (tenantId: string, candidateId: string, fileId: string, type: FileType) =>
  `${tenantId}/${candidateId}/${fileId}.${EXT[type]}`;

export const extensionOf = (type: string) => EXT[type as FileType] ?? "bin";

/** Writes a new file (never overwrites). Returns the absolute path so a failed save can remove it. */
export async function writeFileUnder(root: string, key: string, data: Uint8Array) {
  const full = path.join(root, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data, { flag: "wx" });
  return full;
}

export const readFileUnder = (root: string, key: string) => fs.readFile(path.join(root, key));

export const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
