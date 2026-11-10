import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { brand } from "@/lib/brand";
import { requestOrigin } from "@/lib/origin";
import { audit } from "@/lib/staff";

// Self-hosted email + password. No public sign-up: admins create staff (see src/lib/staff.ts).
// Secret, base URL and extra trusted origins come from BETTER_AUTH_* env vars.
export const auth = betterAuth({
  appName: brand.name,
  database: drizzleAdapter(db, { provider: "pg", schema, usePlural: true }),
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8 },
  session: {
    expiresIn: 60 * 60 * 12, // one 12-hour shift, then sign in again
    disableSessionRefresh: true,
  },
  user: {
    additionalFields: {
      role: { type: "string", required: true, input: false },
      tenantId: { type: "string", required: true, input: false },
      active: { type: "boolean", required: true, defaultValue: true, input: false },
      mustChangePassword: { type: "boolean", required: true, defaultValue: false, input: false },
    },
  },
  databaseHooks: {
    // Better Auth updates the credential account only when the user changes their own password
    // (admin resets write the database directly), so this clears the temporary-password flag.
    account: {
      update: {
        after: async (account) => {
          if (account.providerId !== "credential") return;
          await db.transaction(async (tx) => {
            const [u] = await tx
              .select({ tenantId: schema.users.tenantId, forced: schema.users.mustChangePassword })
              .from(schema.users)
              .where(eq(schema.users.id, account.userId))
              .for("update");
            if (!u) return;
            if (u.forced) await tx.update(schema.users).set({ mustChangePassword: false }).where(eq(schema.users.id, account.userId));
            await audit(tx, { tenantId: u.tenantId, actorUserId: account.userId, action: "user.password_change", entityType: "user", entityId: account.userId, meta: { forced: u.forced } });
          });
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const u = await db.query.users.findFirst({
            columns: { active: true },
            where: eq(schema.users.id, session.userId),
          });
          if (!u?.active) {
            throw new APIError("FORBIDDEN", { message: "This account is deactivated." });
          }
        },
      },
    },
  },
  // Same-origin requests from any address the office PC answers on (see origin.ts).
  // BETTER_AUTH_TRUSTED_ORIGINS can add more (e.g. behind a reverse proxy).
  trustedOrigins: (request) => [request && requestOrigin(request)],
  telemetry: { enabled: false },
});
