import { hashPassword } from "better-auth/crypto";
import { users, accounts, auditLog } from "@/db/schema";
import type { Db, Tx } from "@/db";
import type { Role } from "@/lib/session";

/** Creates a staff login (user + credential account). Returns the new id, or null if the email is taken. */
export async function createStaff(
  tx: Db | Tx,
  input: { tenantId: string; name: string; email: string; role: Role; password: string },
): Promise<string | null> {
  const id = crypto.randomUUID();
  const [row] = await tx
    .insert(users)
    .values({
      id,
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      role: input.role,
      tenantId: input.tenantId,
    })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });
  if (!row) return null;
  await tx.insert(accounts).values({
    id: crypto.randomUUID(),
    accountId: id,
    providerId: "credential",
    userId: id,
    password: await hashPassword(input.password),
  });
  return id;
}

type AuditEntry = typeof auditLog.$inferInsert;

/** Audit rows hold ids and codes only, never personal data. */
export const audit = (tx: Db | Tx, entry: AuditEntry) => tx.insert(auditLog).values(entry);
