# Progress

Phases 1–6 are a proposed outline; adjust before starting each one.

## Phase 0 — Setup + login ✅ (2026-11-10)

- [x] Next.js 15 App Router + TypeScript + Tailwind v4 + ESLint, `src/`, `output: "standalone"`, system fonts only
- [x] `docker-compose.dev.yml` with Postgres 16
- [x] Drizzle ORM, migrations in `/drizzle`, `db:generate` / `db:migrate` / `db:seed`
- [x] Migration `0000_enable_pg_trgm`, then `0001_init_schema` (21 tables, `tenant_id` on every business table)
- [x] Better Auth self-hosted: email + password, public sign-up off, 12-hour sessions, deactivated users blocked
- [x] Roles admin / hr / interviewer / manager; one `ROLES` map; `getStaff`, `requireStaff`, `requireStaffApi`
- [x] Idempotent seed: Simplen tenant, 7 stages, 4 jobs, 1 sample location, first admin from env
- [x] Screens: `/login`, sign out, `/` role redirect, `/dashboard`, `/dashboard/users` (admin), `/intake` placeholder, `/account/password`
- [x] Staff management: add with temporary password, change role, deactivate / reactivate; every change audited (ids only)
- [x] Product name only in `src/lib/brand.ts`
- [x] `CLAUDE.md`, `PROGRESS.md`, `.env.example`, `.gitignore`
- [x] Verified: tsc, lint, build, vitest (16), Playwright (3), API/page QA (81 checks), browser QA (19 checks)

### Known issues / left open from Phase 0

- Docker is not installed on the dev PC used for Phase 0; verification ran on an embedded Postgres 16.x. Run `npm run db:up` once Docker Desktop is installed.
- `npm audit`: 1 high (PostCSS bundled inside Next 15, build-time only, processes our own CSS) and 5 moderate (esbuild-kit under drizzle-kit, dev only). The offered fix is Next 16; revisit when moving off Next 15.
- No forced password change on first sign-in and no admin "reset password" yet. Staff can change their own password at `/account/password`.
- Staff emails are unique across all tenants (Better Auth requirement). Matters only for SaaS.
- Sign-in rate limit (3 tries / 10 s per IP) is in memory; it resets when the server restarts.
- Staff can rename themselves through Better Auth's `update-user` endpoint (role, tenant and active status are protected); not audited.

## Phase 1 — Tablet intake

- [ ] Register the tablet as a device; HR signs in on it
- [ ] Consent screen the candidate taps (versioned notice), stored before any camera use
- [ ] Details form: name, mobile (unique per tenant, 10 digits), email, DOB (under-18 blocked, IST), city, qualification, experience, CTC entered as LPA and stored as rupees/year, notice period, job applied for. No Aadhaar.
- [ ] Repeat walk-in check by mobile with `cooldown_days`
- [ ] Live photo + CV page photos to `/data`, served only through an authed route
- [ ] Token per IST day from `daily_counters` (prefix + number), shown large for the candidate
- [ ] Retry-safe submit with `client_request_id` (tablet on flaky Wi-Fi)

## Phase 2 — Queue and rounds

- [ ] Setup screens: locations, jobs, stages, panels, devices
- [ ] Live queue by stage; call next; move to next stage; `queue_events`
- [ ] Outcomes (selected / rejected with reason / on hold / withdrawn / no show)

## Phase 3 — Scorecards and decisions

- [ ] Interviewer scorecards per stage (1–5 overall, recommendation, comments)
- [ ] Manager round, offer and joined tracking

## Phase 4 — Search and candidate profile

- [ ] Fuzzy name search (pg_trgm) and mobile lookup
- [ ] Candidate profile: visits, applications, files, scorecards

## Phase 5 — Privacy, retention and reports

- [ ] Data subject requests (access, correction, erasure, consent withdrawal)
- [ ] Retention purge: photos after `photo_retention_days`, data after `data_retention_days`
- [ ] CSV exports, daily reports, audit log view

## Phase 6 — Production on the office PC, SaaS readiness

- [ ] Production Docker compose (app + Postgres), backups and restore, update procedure
- [ ] LAN setup guide (fixed IP or hostname for tablets), optional HTTPS on the LAN
- [ ] Tenant onboarding and settings for other companies
