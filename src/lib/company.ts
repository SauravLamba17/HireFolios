// Company profile of a tenant (Settings → Company): display name, short name, token prefix, logo, office address,
// time zone. The PRODUCT name stays in src/lib/brand.ts. The logo is a file under UPLOAD_DIR served by
// GET /api/company/logo to signed-in staff of the same tenant (the lobby TV too).
import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { extensionOf, sniffType } from "@/lib/files";
import { storage } from "@/lib/storage";
import { APP_TIME_ZONE } from "@/lib/ist";

export type Company = {
  name: string;
  shortName: string;
  tokenPrefix: string;
  officeAddress: string | null;
  timeZone: string;
  logoUrl: string | null;
  logoKey: string | null;
  logoType: string | null;
  sample: boolean;
};

export const getCompany = cache(async (tenantId: string): Promise<Company> => {
  const [t] = await db
    .select({
      name: tenants.name,
      shortName: tenants.shortName,
      tokenPrefix: tenants.tokenPrefix,
      officeAddress: tenants.officeAddress,
      timeZone: tenants.timeZone,
      logoKey: tenants.logoKey,
      logoType: tenants.logoType,
      logoUpdatedAt: tenants.logoUpdatedAt,
      sample: tenants.profileSample,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!t) throw new Error("tenant not found");
  return {
    name: t.name,
    shortName: t.shortName || t.name,
    tokenPrefix: t.tokenPrefix,
    officeAddress: t.officeAddress,
    timeZone: t.timeZone,
    logoKey: t.logoKey,
    logoType: t.logoType,
    // the time in the URL makes browsers fetch a changed logo at once
    logoUrl: t.logoKey ? `/api/company/logo?v=${t.logoUpdatedAt?.getTime() ?? 0}` : null,
    sample: t.sample,
  };
});

// Hard rule 7: the app keeps calendar days and times in IST; other zones arrive with the SaaS phase.
export const SUPPORTED_TIME_ZONES = [APP_TIME_ZONE] as const;

export const CompanyInput = z.object({
  name: z.string("Enter the company name").trim().min(2, "Enter the company name").max(120, "Company name is too long"),
  shortName: z.string().trim().max(30, "Short name is too long (30 characters max)").transform((v) => v || null),
  tokenPrefix: z
    .string("Enter a token prefix")
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,3}$/, "Token prefix: 1 to 3 letters or digits, e.g. A or SB"),
  officeAddress: z.string().trim().max(300, "Address is too long").transform((v) => v || null),
  timeZone: z.enum(SUPPORTED_TIME_ZONES, "Only India time (Asia/Kolkata) is supported for now"),
});

export const MAX_LOGO_BYTES = 1024 * 1024;
/** Checks an uploaded logo by its bytes: PNG, JPEG or WebP (never SVG: it can carry scripts). */
export function checkLogo(bytes: Uint8Array): { type: string; ext: string } | string {
  if (bytes.byteLength > MAX_LOGO_BYTES) return "The logo must be 1 MB or smaller.";
  const type = sniffType(bytes);
  if (type !== "image/png" && type !== "image/jpeg" && type !== "image/webp") return "The logo must be a PNG, JPEG or WebP image.";
  return { type, ext: extensionOf(type) };
}

/** Name and logo for Excel exports (ExcelJS takes PNG and JPEG; a WebP logo is left out, the name stays). */
export async function exportCompany(tenantId: string): Promise<{ name: string; logo?: { data: Uint8Array; extension: "png" | "jpeg" } }> {
  const c = await getCompany(tenantId);
  const extension = c.logoType === "image/png" ? "png" : c.logoType === "image/jpeg" ? "jpeg" : null;
  if (!c.logoKey || !extension) return { name: c.name };
  const data = await storage().get(c.logoKey).catch(() => null);
  return data ? { name: c.name, logo: { data: new Uint8Array(data), extension } } : { name: c.name };
}
