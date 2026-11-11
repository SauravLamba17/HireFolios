# Hirefolios — notes for Claude and developers

Walk-in recruitment system for Simplen Billing e-Services (medical billing / RCM).
PC-based: HR registers each walk-in on an office PC with a webcam (details, live photo, CV files
or webcam photos of a paper CV); HR turns the screen and the candidate only reads the notice and
taps consent. Interviewers, managers and the lobby TV use other office PCs in a browser.
Standalone (not part of SESS). Runs on one office PC with Docker + Caddy (HTTPS) at
https://simplen.hirefolios.in; later sold to other companies as SaaS.

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
13. **PERMANENT: manual entry by HR must always work.** HR can type every candidate field by hand. No intake step may
    ever require a CV, a QR code, auto-fill, a webcam or the internet (the photo always has "Upload a photo file
    instead"). Every pre-filled field stays editable before saving. Future helpers (QR self-fill, CV auto-fill) are
    optional extras only. `e2e/manual-intake.spec.ts` guards this: it must keep passing.

## Where things are

| Path | What |
|---|---|
| `src/lib/brand.ts` | Product name, short name, domain |
| `src/db/schema.ts` | Drizzle schema (all tables, enums) |
| `drizzle/` | SQL migrations (`0000` enables pg_trgm) |
| `src/db/seed-core.ts` | Idempotent `seed()`: tenant, stages, jobs, sample location, first admin (`seed.ts` is the CLI) |
| `src/lib/auth.ts` | Better Auth (email + password, sign-up disabled; session length per role from `session-length.ts`: 12 h staff, 30 days display) |
| `src/lib/session.ts` | `ROLES` permission map, `getStaff`, `requireStaff` (pages), `requireStaffApi` (APIs) |
| `src/lib/origin.ts` | Origin the request was sent to (LAN IP, localhost); used for CSRF checks |
| `src/lib/staff.ts` | `createStaff`, `setTemporaryPassword` (admin reset), `audit` |
| `src/lib/options.ts` | Pick-lists (certifications, coding specialties, EHR, education, notice, sources, languages, reject reasons). Sample lists for HR to confirm |
| `src/lib/intake.ts` | Shared intake rules (client + server): `normalizeMobile`, age, zod `IntakeRequest` |
| `src/lib/notice.ts` | Privacy notice (English/Hindi) + `NOTICE_VERSION`. Draft, to be checked by legal |
| `src/lib/money.ts` | LPA ↔ whole rupees per year |
| `src/lib/files.ts` | Candidate files under `UPLOAD_DIR` (absolute path), type sniffing |
| `src/lib/candidate-search.ts` | Candidate list: URL filters, WHERE builder (tenant first), `search_text` for full-text |
| `src/lib/flow.ts` | Stage / outcome rules (pure, unit-tested): next round, Selected, hold, reject, offer / joined, purge dates, assign-next order, wait estimate |
| `src/lib/drive.ts` | Drive day: today's drive, board state, panels, assign, decisions, overrides, `recordOffer`, `markJoined` (one transaction each) |
| `src/lib/retention.ts` | Retention rules (pure, unit-tested): limits, which candidates / photos may be erased, rights-request due dates |
| `src/lib/purge.ts` | Deletion job: `planPurge` (dry run), `runPurge` (re-checks each candidate in its own transaction), scheduler every 30 min |
| `src/lib/privacy.ts` | Rights requests: log / update, erase (refuses joined people), access ZIP, correction |
| `src/lib/exports.ts`, `src/app/api/exports/[kind]/` | CSV (formula-safe) and Excel exports: candidates (current filters), drive day, joined; each logged in `exports` |
| `src/lib/reports.ts` | Report date range + chart helpers; `dashboard/reports` runs the queries (real rows, "as of" time) |
| `src/lib/audit-query.ts` | Audit viewer filters (`dashboard/audit`, CSV at `api/audit/export`) |
| `src/lib/health.ts`, `src/app/api/health/` | Server status (DB, free disk, last backup, version), no auth, no personal data; admin status card |
| `src/instrumentation.ts` → `src/instrumentation-node.ts` | Start-up (Node runtime only; keep `instrumentation.ts` import-free, it is also compiled for edge): migrations (`RUN_MIGRATIONS=1`), seed (`SEED_ON_START=1`), deletion job (unless `PURGE_JOB=off`) |
| `src/lib/live.ts`, `src/app/api/live/` | Server-Sent Events: per-tenant "change" pings only (no data); pages re-read their own state |
| `src/lib/access.ts` | Interviewers see only candidates they were called to interview (pages and files) |
| `src/lib/api.ts` | `act()`: transaction + live ping + rule errors as 400/404 |
| `src/app/(staff)/dashboard/drive/`, `(staff)/interview/`, `tv/` | Drive board (HR), interviewer workspace, lobby TV (display role) |
| `src/app/(staff)/intake/` | PC intake wizard (keyboard-first, webcam picker, CV drop zone): Mobile → Details → Consent → CV → Photo → Save → Token |
| `src/app/(staff)/dashboard/` | Candidate list + search, `candidates/[id]` profile (offer / joined, corrections), `reports`, `privacy`, `audit`, `settings`, `users` |
| `src/app/api/` | `intake`, `candidates/lookup`, `candidates/[id]`, `applications/[id]`, `files/[id]`, `exports/*`, `privacy/*`, `audit/export`, `health`, `settings/*`, `users/*` |
| `scripts/smoke.ts` | `npm run smoke`: end-to-end API check against a running server, in throwaway tenants |
| `e2e/` | Playwright tests (two fake webcams, desk sizes 1440 / 1366x768 / 1024) |
| `Dockerfile`, `docker-compose.yml`, `.env.production.example` | Production: db + app (non-root, migrates on start) + Caddy |
| `deploy/` | Caddyfiles (A: Let's Encrypt via Cloudflare DNS, B: `tls internal`), backup / restore scripts (.ps1 and .sh) |
| `docs/INSTALL.md`, `docs/FIRST-DRIVE-CHECKLIST.md` | Office PC install guide (non-developer), first drive day checklist |

## Patterns

- Page: `const staff = await requireStaff("users");` (redirects to `/login` or the role's home page).
- API: `const { staff, error } = await requireStaffApi(req, "users"); if (error) return error;` (401 / 403, and blocks cross-site writes).
- Add a permission: extend `Permission` and the `ROLES` map in `src/lib/session.ts`; nothing else decides access.
- Roles come from the `staff_role` enum in the schema; TypeScript forces `ROLES` to list every role.
- Creating staff goes through `createStaff` (hashes with Better Auth's scrypt). Public sign-up is off.
  Admin-created and admin-reset passwords are temporary (`users.must_change_password`): `requireStaff`
  sends the user to `/account/password` and `requireStaffApi` answers 403 until they change it.
- Server-only modules (db, `node:*`, auth, anything with secrets) start with `import "server-only"`; client components
  import only pure helpers (`intake`, `options`, `ist`, `notice`, `money`, `send`, `auth-client`).
- Layouts use `getStaff()`; pages use `requireStaff(permission)` (which also enforces the password rule).
- Intake validation lives once in `src/lib/intake.ts`; the wizard and `POST /api/intake` both use it.
- Candidate writes must also write `search_text` (`searchTextFor` in `candidate-search.ts`).
- Ids from URLs: check with `isUuid` (`src/db/index.ts`) and answer 404 for other tenants' ids.
- Pick-list values are stored as their text; add options in `src/lib/options.ts`, never inline.
- Stages, scorecard criteria and reject reasons live in the database (Settings), not in code; the seed only
  fills an empty tenant.
- Every queue move goes through `src/lib/drive.ts` (writes `queue_events` + `audit_log`), via `act()` so live
  screens refresh. Outcome dates come from `outcomeDates()` in `flow.ts`.
- Raw `db.execute(sql...)` rows return timestamps as strings: convert with `toDate` (drive.ts) before date maths.
- The lobby TV (`display` role) must never receive names, photos or mobiles.
- Offers and joining only through `recordOffer` / `markJoined` (drive.ts), rules in `offerOutcome` / `canMarkJoined` (flow.ts).
- Deleting candidate data only through `purge.ts` / `privacy.ts`: never joined, talent-pool or recently-visited candidates
  (`candidateErasable` in retention.ts). Unlink files only after the transaction commits.
- Exports write an `exports` row and an `export.download` audit entry (kind + row count only).
- Report figures come from real rows with an "as of" time; never sample numbers in the UI.

## Commands

```bash
cp .env.example .env          # then fill BETTER_AUTH_SECRET and SEED_ADMIN_*
npm install
npm run db:up                 # Postgres 16 in Docker (docker-compose.dev.yml)
npm run db:migrate
npm run db:seed
npm run dev                   # http://localhost:3000

npm run typecheck && npm run lint && npm test
npm run dev:check             # starts next dev (own port/folder), loads key pages, fails on dev-only build errors
npm run build && npm start    # standalone server (node .next/standalone/server.js)
npm run test:e2e              # needs the DB seeded and a server; PW_CHANNEL=chrome, E2E_BASE_URL, optional E2E_LAN_URL
npm run smoke                 # API smoke test against SMOKE_BASE_URL (default http://localhost:3000)
npm run db:generate -- --name=<change>   # after editing schema.ts

# Production (office PC, see docs/INSTALL.md)
docker compose --env-file .env.production up -d --build
powershell -File deployackup.ps1      # restore: deploy
estore.ps1 -From <backup folder>
```

`UPLOAD_DIR` must be an absolute folder (the standalone server runs from `.next/standalone`, which
a build wipes). To build while `next dev` is running, use `NEXT_DIST_DIR=.next-verify npm run build`
and start `.next-verify/standalone/server.js` (both write to `.next` otherwise).

Other PCs reach the server PC at https://simplen.hirefolios.in (local DNS → its LAN address; Caddy terminates
HTTPS); same-origin sign-in also works from any address the PC answers on (e.g. `http://192.168.1.20:3000` in dev).
Browsers only allow the live webcam on `https://` or localhost; elsewhere the intake offers "Upload a photo file instead".
Behind a reverse proxy, forward `X-Forwarded-Host`/`X-Forwarded-Proto` (Caddy does) or list the public origin in
`BETTER_AUTH_TRUSTED_ORIGINS`.
