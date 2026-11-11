# Progress

Phase 3 is done except the Docker tests (Docker is not installed on the dev PC yet). Phase 4 is listed at the end.

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

## Phase 3 — PC intake, offers, exports, reports, privacy, production files (in progress: Docker tests pending)

- [x] **PC-based intake** (no tablets): keyboard-first wizard (Enter = Next, Esc = back with confirm, focus moves to the
      next field), wider desk layout (1366x768 and up), "turn the screen to the candidate" consent wording (English/Hindi)
- [x] Webcam: picker when there are several (remembered per PC), clear messages for blocked / no webcam / unplugged /
      failed with "Try again", upload fallback, frame guard (no blank photos), A4 outline for paper CVs
- [x] CV step: drag-and-drop or choose up to 5 files (PDF, Word .docx, JPEG/PNG/WebP, 8 MB each) plus webcam pages;
      `.docx` checked by its bytes (ZIP + `word/document.xml`), served as a download
- [x] Migration `0004_offers_privacy` (adds only): `offer_status`, offered CTC, joining date, joined on;
      outcomes `offer_declined` and `joined`; rights-request kind `grievance`, due date, requester, resolution
- [x] Offer / joined on the profile (admin, HR, manager): offered → accepted / declined; declined gets purge dates;
      joined only from Selected (not after a declined offer), never in the future; rules in `flow.ts`, unit-tested
- [x] Exports (admin, HR): candidate list with the current filters (Excel or CSV, formula-safe), drive day (summary +
      candidates), joined; each logged in `exports` + audit (kind and row count only)
- [x] `/dashboard/reports` (admin, HR, manager): walk-ins per day, funnel, pass rates by round, sources, selection by
      position, reject reasons, interviewer load, offer / joining figures; all from real rows with "data as of"
- [x] Retention settings (admin): cooling-off, photo and data periods with limits, optional recalculation of existing
      dates, "due in the next 7 days" preview, last deletion run
- [x] Deletion job (in the server, every 30 minutes): removes photos past their date and candidates whose every visit is
      past its date; never joined, talent-pool or recently-visited candidates; re-checks each candidate in its own
      transaction; files removed after commit; one audit row per run (counts only); dry run (`planPurge`) tested first
- [x] `/dashboard/privacy` (admin, HR): log access / correction / erasure / withdrawal / grievance requests by mobile,
      90-day due date, overdue highlighted; access ZIP (data.json + files), correction (intake rules), erasure (typed
      ERASE, refused for joined employees)
- [x] `/dashboard/audit` (admin): filters by action, staff, date; CSV export
- [x] Lobby TV (`display`) sessions last 30 days, staff 12 hours; admin "Sign out everywhere" per user
- [x] `/api/health` (no auth, no personal data: DB, free disk, last backup, version) and the admin "Server status" card
- [x] Start-up (`src/instrumentation.ts`): migrations and seed when `RUN_MIGRATIONS=1` / `SEED_ON_START=1` (set in the image)
- [x] Written, **not yet run**: `Dockerfile` (multi-stage, standalone, non-root, migrates on start, healthcheck),
      `docker-compose.yml` (db + app + Caddy, `restart: unless-stopped`, uploads bind-mounted), `.env.production.example`,
      `deploy/Caddyfile.cloudflare` (option A, Let's Encrypt via Cloudflare DNS) and `deploy/Caddyfile.internal` (option B,
      `tls internal` + certutil steps), `deploy/backup.ps1|sh` (pg_dump + uploads archive, keep N days, offsite copy,
      writes the last-backup time), `deploy/restore.ps1|sh` (typed RESTORE, safety backup first, one transaction),
      Task Scheduler line (6:15 pm Mon–Sat), `docs/INSTALL.md`, `docs/FIRST-DRIVE-CHECKLIST.md`
- [x] Verified (without Docker): see "Verification" below
- [ ] **Docker tests (after Docker Desktop is installed):** image build, `up -d` on a fresh volume (migrate + seed on
      start, health "ok"), HTTPS with option B (and option A if the Cloudflare token is available), webcam over HTTPS
      from another PC, backup → restore round trip, fresh install from `docs/INSTALL.md`, then the Phase 3 final report

### Verification (Phase 3, without Docker)

- `tsc`, `eslint` clean; `vitest` 127 tests (8 files: flow, retention, reports, exports, files, intake, session, …); production build OK
- Playwright 21/21 with two fake webcams: drive day (4), PC intake (7, incl. keyboard-only registration, webcam
  picker, Word + PDF + webcam CV, plain-http LAN address 192.168.1.7 with uploads), Phase 3 (7: offer → joined,
  filtered Excel / joined CSV, reports figures, retention re-calculation, access ZIP + erase, audit viewer, 30-day TV
  session), staff (3); screenshots at 1440, 1366x768, 1024 (TV 1920x1080) reviewed
- `npm run smoke` 85/85 on localhost, on the LAN address, and on a fresh empty database started the way the Docker image
  starts (`RUN_MIGRATIONS=1`, `SEED_ON_START=1`); includes the deletion job (dry run, real run, re-run) in a throwaway tenant
- QA script 41/41: multi-file / fake `.docx` / 6 files / Excel-as-CV, every role × new pages and APIs, signed out,
  another tenant's ids (offer, correction, erase, update, ZIP → 404), offer rules, privacy edge cases, retention limits,
  end-of-day Excel, health + status card, no webcam, blocked webcam, webcam unplugged mid-capture + Try again, CV limits
- A failed start-up (e.g. migrations) now exits with code 1 instead of serving errors (checked)
- Fixed during testing (logged before fixing): report dates like 30 Feb accepted; "Find" again skipped the lookup;
  CV limit message missing; "No webcam found" while the previous step released the webcam; failed start-up kept serving
  500s; privacy status select not following "Erase now"; "talent pool" label on joined employees; "1 entries";
  install guide wording; smoke test now waits out the sign-in limit when another test run used it

### Known issues / left open after Phase 3

- **Docker parts are untested** until Docker is installed (see the open item above). The PowerShell / shell scripts
  were only syntax-checked.
- **To confirm with Simplen:** retention periods (defaults: 90-day cooling-off, photos 180 days, data 365 days), who
  answers rights requests. The privacy notice does not yet name a contact for requests and complaints; add one
  (and bump `NOTICE_VERSION`) once Simplen decides.
- The deletion job runs inside the app server; if the server is off for days, it catches up on the next start.
- Erasure keeps the audit trail (ids only). Excel / CSV files already downloaded are outside the system and must be
  deleted by hand.
- Old `.doc` (Word 97–2003) files are refused; save them as `.docx` or PDF first.
- A Word CV is downloaded, not shown in the browser (no viewer runs offline).
- Still open from earlier phases: `npm audit` findings in build tools (fix needs Next 16), staff emails unique across
  tenants, in-memory sign-in rate limit, staff can rename themselves via `update-user`, in-process live-update bus.

### Known issues → fixed (after Phase 3)

- **`next dev` failed on every page** with `UnhandledSchemeError: Reading from "node:crypto"` (production builds were
  fine). Chain: `src/instrumentation.ts` → `src/lib/boot.ts` → `drizzle-orm/postgres-js/migrator` → `drizzle-orm/migrator`
  → `node:crypto`, compiled for the **edge** runtime too: the `if (NEXT_RUNTIME !== "nodejs") return;` early return
  does not stop webpack from following the dynamic import after it. Fixed: `register()` only does
  `if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node")`, and all start-up work moved
  to `src/instrumentation-node.ts` (was `boot.ts`). Every server-only module (`src/db/index.ts`, `seed-core.ts` and the
  db / node / auth libs in `src/lib`) now starts with `import "server-only"`, so a client component importing one
  fails at compile time with a clear message (checked). `tsx` scripts run with `--conditions=react-server` and vitest
  aliases `server-only` to its empty module. New `npm run dev:check` starts `next dev`, signs in as the seed admin,
  loads 13 key pages and fails on build errors, 5xx, or the deletion job not starting exactly once (it fails on the
  old `instrumentation.ts`).

## Phase 4 — next

- [ ] One-time QR link so a candidate can upload their CV from their own phone (through a Cloudflare Tunnel)
- [ ] CV auto-fill (read details from the uploaded CV, offline, no paid APIs)
- [ ] Intake order Mobile → CV → Details (so auto-fill can prefill the details)
- [ ] Flag photos that were uploaded rather than taken live ("uploaded, not live")
- Later: tenant onboarding and settings for other companies (SaaS), merge possible duplicates
