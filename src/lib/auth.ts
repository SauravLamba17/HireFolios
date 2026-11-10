import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { brand } from "@/lib/brand";
import { requestOrigin } from "@/lib/origin";

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
    },
  },
  databaseHooks: {
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
