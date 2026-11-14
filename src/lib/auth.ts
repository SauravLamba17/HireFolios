import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { brand } from "@/lib/brand";
import { config } from "@/lib/config";
import { clientIp } from "@/lib/net";
import { requestOrigin } from "@/lib/origin";
import { addressAllowed, tenantOfEmail } from "@/lib/security-settings";
import { audit } from "@/lib/staff";
import { sessionLengths, sessionSeconds } from "@/lib/session-length";

// Self-hosted email + password. No public sign-up: admins create staff (see src/lib/staff.ts).
// Secret, base URL and extra trusted origins come from BETTER_AUTH_* env vars.
// Internet-facing (Phase 5): authenticator-app two-factor with recovery codes, sign-in limits per address kept in the
// database, account lockout after LOCKOUT_ATTEMPTS wrong passwords (audited), the optional office IP allow-list, and
// Secure cookies whenever the public address is https.
const cfg = (() => {
  try {
    return config();
  } catch {
    return null; // start-up stops with the configuration message first (src/instrumentation-node.ts)
  }
})();
const [signInMax, signInWindow] = (cfg?.SIGN_IN_LIMIT ?? "20/60").split("/").map(Number);
const emailOf = (body: unknown) => String((body as { email?: unknown } | null)?.email ?? "").trim().toLowerCase();

export const auth = betterAuth({
  appName: brand.name,
  database: drizzleAdapter(db, { provider: "pg", schema, usePlural: true }),
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8 },
  session: {
    // The cookie may live as long as the longest session (the lobby TV); each session row gets its
    // own expiry below (sessionSeconds), so staff still sign in every shift (STAFF_SESSION_HOURS).
    expiresIn: sessionLengths().display,
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
            columns: { active: true, role: true },
            where: eq(schema.users.id, session.userId),
          });
          if (!u?.active) {
            throw new APIError("FORBIDDEN", { message: "This account is deactivated." });
          }
          return { data: { ...session, expiresAt: new Date(Date.now() + sessionSeconds(u.role) * 1000) } };
        },
      },
    },
  },
  plugins: [
    twoFactor({
      issuer: brand.name,
      backupCodeOptions: { amount: 10, length: 10 },
      // wrong authenticator / recovery codes: locked for 15 minutes after 10 tries (plugin default, made explicit)
      accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 900 },
    }),
  ],
  rateLimit: {
    storage: "database", // survives restarts, shared by every app instance (table rate_limits)
    customRules: {
      "/sign-in/email": { window: signInWindow, max: signInMax },
      "/two-factor/verify-totp": { window: 60, max: 10 },
      "/two-factor/verify-backup-code": { window: 60, max: 10 },
    },
  },
  advanced: {
    useSecureCookies: (cfg?.BETTER_AUTH_URL ?? "").startsWith("https://"),
    // Caddy (office PC and AWS) writes the real client address here; see src/lib/net.ts
    ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      const u = await tenantOfEmail(emailOf(ctx.body));
      if (!u) return; // unknown email: the normal "wrong email or password"
      if (u.lockedUntil && u.lockedUntil > new Date()) {
        const minutes = Math.ceil((u.lockedUntil.getTime() - Date.now()) / 60_000);
        throw new APIError("FORBIDDEN", { code: "ACCOUNT_LOCKED", message: `This account is locked for ${minutes} more minute${minutes === 1 ? "" : "s"} after too many wrong passwords. Try later or ask your admin.` });
      }
      if (!(await addressAllowed(u.tenantId, ctx.headers ? clientIp(ctx.headers) : null))) {
        await audit(db, { tenantId: u.tenantId, actorUserId: u.id, action: "auth.ip_blocked", entityType: "user", entityId: u.id });
        throw new APIError("FORBIDDEN", { code: "IP_NOT_ALLOWED", message: "Sign-in is allowed only from the office network. Ask your admin." });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      const u = await tenantOfEmail(emailOf(ctx.body));
      if (!u) return;
      const r = ctx.context.returned as { statusCode?: number; status?: string } | undefined;
      const wrongPassword = r instanceof APIError && r.statusCode === 401;
      if (!wrongPassword) {
        if (!(r instanceof APIError)) await db.update(schema.users).set({ failedSignIns: 0 }).where(eq(schema.users.id, u.id));
        return;
      }
      const max = cfg?.LOCKOUT_ATTEMPTS ?? 5;
      const [row] = await db
        .update(schema.users)
        .set({ failedSignIns: sql`${schema.users.failedSignIns} + 1` })
        .where(eq(schema.users.id, u.id))
        .returning({ n: schema.users.failedSignIns });
      await audit(db, { tenantId: u.tenantId, actorUserId: null, action: "auth.sign_in_failed", entityType: "user", entityId: u.id, meta: { attempt: row.n } });
      if (row.n >= max) {
        const until = new Date(Date.now() + (cfg?.LOCKOUT_MINUTES ?? 15) * 60_000);
        await db.update(schema.users).set({ failedSignIns: 0, lockedUntil: until }).where(eq(schema.users.id, u.id));
        // the "notification": admins see it in Audit (and the user's row in Staff shows it locked)
        await audit(db, { tenantId: u.tenantId, actorUserId: null, action: "auth.lockout", entityType: "user", entityId: u.id, meta: { attempts: row.n, minutes: cfg?.LOCKOUT_MINUTES ?? 15 } });
      }
    }),
  },
  // Same-origin requests from any address the office PC answers on (see origin.ts).
  // BETTER_AUTH_TRUSTED_ORIGINS can add more (e.g. behind a reverse proxy).
  trustedOrigins: (request) => [request && requestOrigin(request)],
  telemetry: { enabled: false },
});
