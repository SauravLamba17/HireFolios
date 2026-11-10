# Hirefolios — notes for Claude and developers

Walk-in recruitment system for Simplen Billing e-Services (medical billing / RCM).
HR registers each walk-in on an Android tablet (details, live photo, CV page photos); the
candidate only taps consent. Interviewers and managers use office PCs. Standalone (not part
of SESS). Runs on an office PC with Docker; later sold to other companies as SaaS.

Read `PROGRESS.md` first and continue from where it stops.

## Hard rules

1. **No paid APIs.** No AI, SMS, WhatsApp API, OCR or hosted auth services. Everything runs on the office PC.
2. **Tenant isolation.** Every business table has `tenant_id`. Every query filters on the signed-in staff member's `tenantId`, server-side. Never take a tenant id from the client.
3. **Files are never public.** Photos and CV pages live under `/data` (gitignored), outside `public/`, and are served only through an authenticated route that checks tenant and role.
4. **Consent before camera.** No photo or CV page may be captured until a `consents` row exists for that candidate.
5. **No Aadhaar at intake.** Do not add an Aadhaar field, photo or OCR anywhere in intake.
6. **Under-18 blocked.** Intake refuses candidates younger than 18 (age computed on the IST calendar date).
7. **IST dates.** Dates shown to staff are Asia/Kolkata (`src/lib/ist.ts`). Calendar days (token day, drive day) are IST `date` columns.
8. **Money.** Store whole rupees per year as integers (`current_ctc`, `expected_ctc`). Show as LPA (e.g. 350000 → "3.5 LPA").
9. **Works offline on the office LAN.** No CDNs, no Google Fonts (system fonts only), no runtime calls to the internet.
10. **Product name only from `src/lib/brand.ts`.** Never hardcode the product name, short name or domain anywhere else in code (docs are fine).
11. **Audit log holds ids only.** `audit_log.meta` may contain ids, roles and codes, never names, mobiles, emails or other personal data.
12. **Ask first** before deleting files, rewriting git history, dropping databases, or adding any paid service or external API.

## Where things are

| Path | What |
|---|---|
| `src/lib/brand.ts` | Product name, short name, domain |
| `src/db/schema.ts` | Drizzle schema (all tables, enums) |
| `drizzle/` | SQL migrations (`0000` enables pg_trgm) |
| `src/db/seed.ts` | Idempotent seed: tenant, stages, jobs, sample location, first admin |
| `src/lib/auth.ts` | Better Auth (email + password, sign-up disabled, 12-hour sessions) |
| `src/lib/session.ts` | `ROLES` permission map, `getStaff`, `requireStaff` (pages), `requireStaffApi` (APIs) |
| `src/lib/origin.ts` | Origin the request was sent to (LAN IP, localhost); used for CSRF checks |
| `src/lib/staff.ts` | `createStaff`, `audit` |
| `src/app/(staff)/` | Signed-in pages with the shared header |
| `src/app/api/users/` | Staff management API (admin only) |
| `e2e/` | Playwright tests |

## Patterns

- Page: `const staff = await requireStaff("users");` (redirects to `/login` or the role's home page).
- API: `const { staff, error } = await requireStaffApi(req, "users"); if (error) return error;` (401 / 403, and blocks cross-site writes).
- Add a permission: extend `Permission` and the `ROLES` map in `src/lib/session.ts`; nothing else decides access.
- Roles come from the `staff_role` enum in the schema; TypeScript forces `ROLES` to list every role.
- Creating staff goes through `createStaff` (hashes with Better Auth's scrypt). Public sign-up is off.

## Commands

```bash
cp .env.example .env          # then fill BETTER_AUTH_SECRET and SEED_ADMIN_*
npm install
npm run db:up                 # Postgres 16 in Docker (docker-compose.dev.yml)
npm run db:migrate
npm run db:seed
npm run dev                   # http://localhost:3000

npm run typecheck && npm run lint && npm test
npm run build && npm start    # standalone server (node .next/standalone/server.js)
npm run test:e2e              # needs the DB seeded; set PW_CHANNEL=chrome or run `npx playwright install chromium`
npm run db:generate -- --name=<change>   # after editing schema.ts
```

Tablets reach the office PC by its LAN address (e.g. `http://192.168.1.20:3000`); same-origin
sign-in works from any address the PC answers on. Behind a reverse proxy, forward
`X-Forwarded-Host`/`X-Forwarded-Proto` or list the public origin in `BETTER_AUTH_TRUSTED_ORIGINS`.
