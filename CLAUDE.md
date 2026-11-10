# Hirefolios — notes for Claude and developers

Walk-in recruitment system for Simplen Billing e-Services (medical billing / RCM).
HR registers each walk-in on an Android tablet (details, live photo, CV page photos); the
candidate only taps consent. Interviewers and managers use office PCs. Standalone (not part
of SESS). Runs on an office PC with Docker; later sold to other companies as SaaS.

Read `PROGRESS.md` first and continue from where it stops.

## Hard rules

1. **No paid APIs.** No AI, SMS, WhatsApp API, OCR or hosted auth services. Everything runs on the office PC.
2. **Tenant isolation.** Every business table has `tenant_id`. Every query filters on the signed-in staff member's `tenantId`, server-side. Never take a tenant id from the client.
3. **Files are never public.** Photos and CV pages live under `UPLOAD_DIR` (an absolute path; in dev the gitignored `/data/uploads`), outside `public/`, and are served only through `GET /api/files/[id]`, which checks the signed-in staff member's tenant.
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
| `src/lib/staff.ts` | `createStaff`, `setTemporaryPassword` (admin reset), `audit` |
| `src/lib/options.ts` | Pick-lists (certifications, coding specialties, EHR, education, notice, sources, languages, reject reasons). Sample lists for HR to confirm |
| `src/lib/intake.ts` | Shared intake rules (client + server): `normalizeMobile`, age, zod `IntakeRequest` |
| `src/lib/notice.ts` | Privacy notice (English/Hindi) + `NOTICE_VERSION`. Draft, to be checked by legal |
| `src/lib/money.ts` | LPA ↔ whole rupees per year |
| `src/lib/files.ts` | Candidate files under `UPLOAD_DIR` (absolute path), type sniffing |
| `src/lib/candidate-search.ts` | Candidate list: URL filters, WHERE builder (tenant first), `search_text` for full-text |
| `src/lib/flow.ts` | Stage / outcome rules (pure, unit-tested): next round, Selected, hold, reject, purge dates, assign-next order, wait estimate |
| `src/lib/drive.ts` | Drive day: today's drive, board state, panels, assign, decisions, overrides (one transaction each) |
| `src/lib/live.ts`, `src/app/api/live/` | Server-Sent Events: per-tenant "change" pings only (no data); pages re-read their own state |
| `src/lib/access.ts` | Interviewers see only candidates they were called to interview (pages and files) |
| `src/lib/api.ts` | `act()`: transaction + live ping + rule errors as 400/404 |
| `src/app/(staff)/dashboard/drive/`, `(staff)/interview/`, `tv/` | Drive board (HR), interviewer workspace, lobby TV (display role) |
| `src/app/(staff)/intake/` | Tablet wizard: Mobile → Details → Consent → CV → Photo → Save → Token |
| `src/app/(staff)/dashboard/` | Candidate list + search, `candidates/[id]` profile, `settings`, `users` |
| `src/app/api/` | `intake`, `candidates/lookup`, `files/[id]`, `settings/*`, `users/*` |
| `scripts/smoke.ts` | `npm run smoke`: end-to-end API check against a running server, in throwaway tenants |
| `e2e/` | Playwright tests (fake camera) |

## Patterns

- Page: `const staff = await requireStaff("users");` (redirects to `/login` or the role's home page).
- API: `const { staff, error } = await requireStaffApi(req, "users"); if (error) return error;` (401 / 403, and blocks cross-site writes).
- Add a permission: extend `Permission` and the `ROLES` map in `src/lib/session.ts`; nothing else decides access.
- Roles come from the `staff_role` enum in the schema; TypeScript forces `ROLES` to list every role.
- Creating staff goes through `createStaff` (hashes with Better Auth's scrypt). Public sign-up is off.
  Admin-created and admin-reset passwords are temporary (`users.must_change_password`): `requireStaff`
  sends the user to `/account/password` and `requireStaffApi` answers 403 until they change it.
- Layouts use `getStaff()`; pages use `requireStaff(permission)` (which also enforces the password rule).
- Intake validation lives once in `src/lib/intake.ts`; the tablet and `POST /api/intake` both use it.
- Candidate writes must also write `search_text` (`searchTextFor` in `candidate-search.ts`).
- Ids from URLs: check with `isUuid` (`src/db/index.ts`) and answer 404 for other tenants' ids.
- Pick-list values are stored as their text; add options in `src/lib/options.ts`, never inline.
- Stages, scorecard criteria and reject reasons live in the database (Settings), not in code; the seed only
  fills an empty tenant.
- Every queue move goes through `src/lib/drive.ts` (writes `queue_events` + `audit_log`), via `act()` so live
  screens refresh. Outcome dates come from `outcomeDates()` in `flow.ts`.
- Raw `db.execute(sql...)` rows return timestamps as strings: convert with `toDate` (drive.ts) before date maths.
- The lobby TV (`display` role) must never receive names, photos or mobiles.

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
npm run test:e2e              # needs the DB seeded and a server; PW_CHANNEL=chrome, E2E_BASE_URL, optional E2E_LAN_URL
npm run smoke                 # API smoke test against SMOKE_BASE_URL (default http://localhost:3000)
npm run db:generate -- --name=<change>   # after editing schema.ts
```

`UPLOAD_DIR` must be an absolute folder (the standalone server runs from `.next/standalone`, which
a build wipes). To build while `next dev` is running, use `NEXT_DIST_DIR=.next-verify npm run build`
and start `.next-verify/standalone/server.js` (both write to `.next` otherwise).

Tablets reach the office PC by its LAN address (e.g. `http://192.168.1.20:3000`); same-origin
sign-in works from any address the PC answers on. Browsers only allow the live camera on
`https://` or localhost; over plain http the tablet falls back to the camera app (file input). Behind a reverse proxy, forward
`X-Forwarded-Host`/`X-Forwarded-Proto` or list the public origin in `BETTER_AUTH_TRUSTED_ORIGINS`.
