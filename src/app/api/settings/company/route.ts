import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { act, badRequest } from "@/lib/api";
import { checkLogo, CompanyInput, MAX_LOGO_BYTES } from "@/lib/company";
import { storage } from "@/lib/storage";
import { firstIssue } from "@/lib/intake";
import { publish } from "@/lib/live";
import { requireStaffApi } from "@/lib/session";
import { audit } from "@/lib/staff";

// Settings → Company (admin): profile fields (JSON PATCH), logo upload (multipart POST) and removal (DELETE).
export async function PATCH(req: Request) {
  const { staff, error } = await requireStaffApi(req, "settings");
  if (error) return error;
  const parsed = CompanyInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const c = parsed.data;
  return act(staff, async (tx) => {
    await tx
      .update(tenants)
      .set({ name: c.name, shortName: c.shortName, tokenPrefix: c.tokenPrefix, officeAddress: c.officeAddress, timeZone: c.timeZone, profileSample: false })
      .where(eq(tenants.id, staff.tenantId));
    await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "company.update", entityType: "tenant", entityId: staff.tenantId, meta: { tokenPrefix: c.tokenPrefix } });
  });
}

async function oldLogo(tenantId: string) {
  const [t] = await db.select({ key: tenants.logoKey }).from(tenants).where(eq(tenants.id, tenantId));
  return t?.key ?? null;
}
// The old file goes only after the new row is committed.
async function unlinkQuietly(key: string | null) {
  if (key) await storage().delete([key]).catch(() => {});
}

export async function POST(req: Request) {
  const { staff, error } = await requireStaffApi(req, "settings");
  if (error) return error;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_LOGO_BYTES + 64 * 1024) return badRequest("The logo must be 1 MB or smaller.");
  const form = await req.formData().catch(() => null);
  const file = form?.get("logo");
  if (!(file instanceof Blob) || file.size === 0) return badRequest("Choose a logo file.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ok = checkLogo(bytes);
  if (typeof ok === "string") return badRequest(ok);
  const key = `${staff.tenantId}/company/logo-${crypto.randomUUID()}.${ok.ext}`;
  const before = await oldLogo(staff.tenantId);
  await storage().put(key, bytes, ok.type);
  try {
    await db.transaction(async (tx) => {
      await tx.update(tenants).set({ logoKey: key, logoType: ok.type, logoUpdatedAt: new Date() }).where(eq(tenants.id, staff.tenantId));
      await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "company.logo", entityType: "tenant", entityId: staff.tenantId, meta: { type: ok.type } });
    });
  } catch (e) {
    await unlinkQuietly(key);
    throw e;
  }
  await unlinkQuietly(before);
  publish(staff.tenantId);
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { staff, error } = await requireStaffApi(req, "settings");
  if (error) return error;
  const before = await oldLogo(staff.tenantId);
  await db.transaction(async (tx) => {
    await tx.update(tenants).set({ logoKey: null, logoType: null, logoUpdatedAt: new Date() }).where(eq(tenants.id, staff.tenantId));
    await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "company.logo_remove", entityType: "tenant", entityId: staff.tenantId });
  });
  await unlinkQuietly(before);
  publish(staff.tenantId);
  return Response.json({ ok: true });
}
