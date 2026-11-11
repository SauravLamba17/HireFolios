import "server-only";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { users, accounts, auditLog, sessions } from "@/db/schema";
import type { Db, Tx } from "@/db";
import type { Role } from "@/lib/session";

export const TempPassword = z
  .string("Enter a temporary password")
  .min(8, "Temporary password must be at least 8 characters")
  .max(128, "Temporary password must be at most 128 characters");

/**
 * Creates a staff login (user + credential account). Returns the new id, or null if the email is taken.
 * `temporary`: the password came from an admin, so the user must change it on first sign-in.
 */
export async function createStaff(
  tx: Db | Tx,
  input: { tenantId: string; name: string; email: string; role: Role; password: string; temporary: boolean },
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
      mustChangePassword: input.temporary,
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

/** Admin reset: new temporary password, forced change at next sign-in, signed out everywhere now. */
export async function setTemporaryPassword(tx: Tx, userId: string, password: string) {
  const hash = await hashPassword(password);
  const updated = await tx
    .update(accounts)
    .set({ password: hash })
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")))
    .returning({ id: accounts.id });
  if (updated.length === 0) {
    await tx.insert(accounts).values({ id: crypto.randomUUID(), accountId: userId, providerId: "credential", userId, password: hash });
  }
  await tx.update(users).set({ mustChangePassword: true }).where(eq(users.id, userId));
  await tx.delete(sessions).where(eq(sessions.userId, userId));
}

type AuditEntry = typeof auditLog.$inferInsert;

/** Audit rows hold ids and codes only, never personal data. */
export const audit = (tx: Db | Tx, entry: AuditEntry) => tx.insert(auditLog).values(entry);
