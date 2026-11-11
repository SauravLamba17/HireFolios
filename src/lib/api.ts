import "server-only";
import { db, isUniqueViolation, type Tx } from "@/db";
import { FlowError, NotFoundError } from "@/lib/flow";
import { publish } from "@/lib/live";
import type { Staff } from "@/lib/session";

/**
 * Runs a write in one transaction, then tells live screens of this tenant to refresh.
 * Rule violations (FlowError) become a 400 with their message; unique clashes a 409.
 */
export async function act<T>(staff: Staff, fn: (tx: Tx) => Promise<T>, conflict = "That name is already used.") {
  try {
    const result = await db.transaction(fn);
    publish(staff.tenantId);
    return Response.json({ ok: true, result: result ?? null });
  } catch (e) {
    if (e instanceof FlowError) return Response.json({ error: e.message }, { status: e instanceof NotFoundError ? 404 : 400 });
    if (isUniqueViolation(e, "applications_panel_uq")) return Response.json({ error: "That panel already has a candidate." }, { status: 409 });
    const code = ((e as { cause?: { code?: string } })?.cause ?? (e as { code?: string }))?.code;
    if (code === "23505") return Response.json({ error: conflict }, { status: 409 });
    throw e;
  }
}

export const badRequest = (error: string) => Response.json({ error }, { status: 400 });
