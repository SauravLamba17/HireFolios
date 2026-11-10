# Progress

Phases 3–6 are a proposed outline; adjust before starting each one.

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
- ~~No forced password change on first sign-in and no admin "reset password" yet.~~ Done in Phase 1.
- Staff emails are unique across all tenants (Better Auth requirement). Matters only for SaaS.
- Sign-in rate limit (3 tries / 10 s per IP) is in memory; it resets when the server restarts.
- Staff can rename themselves through Better Auth's `update-user` endpoint (role, tenant and active status are protected); not audited.

## Phase 1 — Intake + search (Simplen) ✅ (2026-11-10)

- [x] RCM fields (migration `0002_rcm_fields_settings_intake`, nothing dropped): certifications, coding specialties,
      EHR/PM software, night/US shift, voice process, typing WPM, languages, skills; jobs get required certifications,
      openings, min/max experience, open/paused/closed status
- [x] All pick-lists in `src/lib/options.ts` (sample lists for Simplen HR to confirm)
- [x] Seed adds the 11 Simplen positions (flagged `sample` until an admin saves them in Settings)
- [x] `/dashboard/settings` (admin): rename location; add / edit jobs; every change audited
- [x] Temporary passwords: forced change on first sign-in; admin "Reset password" (forces a change again, signs the user out); both audited
- [x] `/intake` tablet wizard: Mobile → Details → Consent (English/Hindi, candidate-facing full screen) → CV pages / upload → Photo → Save → Token
- [x] `GET /api/candidates/lookup`: prefill, last 10 visits, today's token, cooldown (HR only)
- [x] `POST /api/intake`: one transaction, daily IST token A-001…, consent row before file rows, idempotent on `client_request_id`,
      files removed if the save fails, possible duplicates (same email; similar name + same DOB)
- [x] `GET /api/files/[id]`: same-tenant staff only, nosniff, private cache, 404 for other tenants
- [x] `/dashboard` candidate list: fuzzy name, full text, email, partial mobile; 8 filters in the URL; 25 per page
- [x] `/dashboard/candidates/[id]` profile: details, RCM, visits, CV gallery / uploaded CV, consent record; views audited
- [x] Header: Candidates, + New candidate, Settings, Staff, name · role · Change password, sign out
- [x] Verified: tsc, lint, build, vitest (78), Playwright (10, fake camera, incl. LAN fallback), `npm run smoke` (52, localhost + LAN + fresh DB), QA script (46)

### Known issues / left open after Phase 1

- **Camera needs HTTPS.** Over plain `http://<LAN IP>` browsers block the live camera, so the tablet uses the camera-app
  fallback (works, tested). For the live camera with the oval guide, serve the app over HTTPS on the LAN (Phase 6, or sooner).
- **To confirm with Simplen HR / legal:** the 11 positions (Settings shows "Sample — check and save"), all option lists in
  `src/lib/options.ts`, and the privacy notice in `src/lib/notice.ts` (`NOTICE_VERSION = draft-2026-11-10`; English and
  Hindi; Hindi needs a native-speaker check). Changing the notice text means bumping `NOTICE_VERSION`.
- Databases seeded in Phase 0 also have the old sample jobs "AR Caller", "Medical Biller" and "Other" (the seed never
  deletes). Close them in Settings if not wanted. A fresh database only has the 11 new ones.
- `jobs.active` is kept only for compatibility and mirrors `status = 'open'`; drop it later (ask first).
- `tenants.token_prefix` is not used yet: tokens are `A-001`, `A-002`… per tenant per IST day.
- Typing speed is typed in by HR; no typing test yet.
- No tablet/device registration yet (`devices` table unused); `consents.device_id` stays empty.
- Interviewers have no candidate list yet (Phase 2). Any signed-in staff member of the tenant can open a file by id.
- Fuzzy name search does not use the trigram index (fine for tens of thousands of candidates; see `candidate-search.ts`).
- `npm run build` and `next dev` both write to `.next`; to build while dev is running use `NEXT_DIST_DIR=.next-verify`.
- E2E: headless Chrome's fake camera sometimes refuses to open (about 1 run in 10 on the dev PC, also without any app
  code); the test then uses the app's camera-app fallback and says so in the output.
- Still open from Phase 0: Docker not installed on the dev PC, `npm audit` findings in build tools (fix needs Next 16),
  staff emails unique across tenants, in-memory sign-in rate limit, staff can rename themselves via `update-user`.

## Phase 2 — Drive day + interviews ✅ (2026-11-10)

- [x] Migration `0003_drive_day_interviews` (adds only): stage interview flag + scorecard criteria + sample flag,
      `reject_reasons` table, tenant average interview minutes, drive close, panel drive/interviewer/status,
      application panel/decided/purge dates, queue event interviewer + note (+ `returned` event), scorecard decision,
      `display` role, one-candidate-per-panel unique index, one drive per location per day
- [x] Settings (admin): stages (rename, reorder, activate, interview round, criteria with "required"), reject reasons,
      average interview minutes; sample defaults flagged until saved; all audited
- [x] Drives auto-created per IST day and location; panels (room, interviewer, round, available / busy / away / closed)
- [x] `/dashboard/drive`: waiting by round (photo, token, minutes waiting, wait estimate or "—", cooldown/duplicate
      for HR), in interview by panel with timer, done today; Assign next, manual pick, back to waiting, no-show,
      walked away, end of day summary / reopen. Managers watch read-only
- [x] Live updates: SSE (tenant-scoped pings), 5 s polling while disconnected, automatic reconnect
- [x] `/tv` lobby screen (display role): now calling + 4 previous calls + waiting count, tokens and rooms only, chime toggle
- [x] `/interview`: panel status, candidate + RCM + CV side by side, earlier rounds, 1–5 scorecard, Pass / Hold / Reject (listed reason)
- [x] Stage/outcome rules in `src/lib/flow.ts` (unit-tested); purge dates on reject / no-show / walked away unless talent pool
- [x] Manager/admin override on the profile (reason required, audited); HR resumes on-hold candidates
- [x] Profile: per-visit rounds (interviewer, scores, decision, reason, time) and timeline
- [x] Interviewers only see candidates assigned to them (profile + files, enforced on the server)
- [x] Verified: tsc, lint, build, vitest (96), Playwright (14 incl. drive day in 5 browser contexts), smoke (75, localhost + LAN + fresh DB), QA (43 + 4 reconnect)

### Known issues / left open after Phase 2

- **To confirm with Simplen HR:** the stages and which are interview rounds, the scorecard criteria per round
  (sample: Communication, Process knowledge, Typing / voice, Attitude & stability), required criteria, the reject
  reasons, and the average interview minutes (not set: the board shows "—" until 3 interviews finish each day).
- The lobby TV signs in with a `display` account; like every session it lasts 12 hours, so the TV needs signing in each morning.
- Live updates use an in-process event bus: fine for the single office PC; several app instances would need Postgres LISTEN/NOTIFY.
- Purge dates are set but nothing deletes data yet (retention job is Phase 5). No-show and walked-away also get purge dates.
- Panel rows are rooms reused across days (unique room name per tenant); history is kept in `queue_events` and scorecards.
- Wait estimates and the "minutes waiting" timer are approximate by design (position × average ÷ panels).
- "End of day" sends anyone still in a room back to waiting; they stay in progress until HR marks them.

## Phase 3 — Offers and joining

- [ ] Offer letters, joined / not joined tracking after Selected
- [ ] Reports from scorecards (pass rates by round, reasons)

## Phase 4 — Candidate records

- [ ] Edit a candidate's details outside intake (keeps `search_text` in sync)
- [ ] Merge possible duplicates flagged at intake

## Phase 5 — Privacy, retention and reports

- [ ] Data subject requests (access, correction, erasure, consent withdrawal)
- [ ] Retention purge: photos after `photo_retention_days`, data after `data_retention_days`
- [ ] CSV exports, daily reports, audit log view

## Phase 6 — Production on the office PC, SaaS readiness

- [ ] Production Docker compose (app + Postgres), backups and restore, update procedure
- [ ] LAN setup guide (fixed IP or hostname for tablets) and HTTPS on the LAN (needed for the live camera)
- [ ] Tenant onboarding and settings for other companies
