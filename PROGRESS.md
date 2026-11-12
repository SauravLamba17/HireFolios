# Progress

Phase 3.5 is complete (2026-11-12): lists, privacy notice and company profile in the database with Settings screens,
configuration checked at start-up, a permanent dev PostgreSQL 16, pinned versions and an office machine check.
Phase 3 (2026-11-11): native Windows install, no Docker for Simplen. Phase 4 is listed at the end.

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

## Phase 3 — PC intake, offers, exports, reports, privacy, Windows install ✅ (2026-11-11)

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
- [x] Start-up (`src/instrumentation.ts`): migrations and seed when `RUN_MIGRATIONS=1` / `SEED_ON_START=1` (set by install.ps1)
- [x] Docker files (written in Phase 3, never run) moved to `deploy/docker/`, marked optional for a future cloud / SaaS
      setup, not used for Simplen and not maintained
- [x] **PERMANENT rule (CLAUDE.md hard rule 13): manual entry by HR always works.** New `e2e/manual-intake.spec.ts`
      types every field by hand, no CV, no webcam (photo through "Upload a photo file instead"), checks every saved
      value and that no request left the server
- [x] `npm run package [-- --version X]` (`scripts/package.mjs`): `release/hirefolios-<version>/` + `.zip` with the
      standalone server, static files, migrations (the seed runs inside the server), the Node.js it was built with
      (`node.exe`, OpenJS-signed), `VERSION.txt` / `release.env`, the Windows scripts, WinSW + Caddy (pinned versions,
      SHA-256 checked) and the docs; no source, no tests, no `.env` (fails if one is there or if a secret from this
      PC's `.env` appears in any file)
- [x] `deploy/windows/install.ps1` (Administrator, safe to re-run): checks Windows / admin / disk / ports 80, 443 and the
      app port; PostgreSQL 16 via winget (or `-PostgresInstaller` offline, EnterpriseDB signature checked) or an existing
      16+ (asks its `postgres` password); own database + login with generated passwords (saved the moment they are
      made); asks the address, HTTPS option and admin email / password; writes `C:\hirefolios\.env` (ACL: SYSTEM,
      Administrators, the service only); uploads in `C:\hirefolios-data\uploads`; services `hirefolios` (WinSW) and
      `hirefolios-caddy`, each as its own virtual account, automatic start, restart on failure; PostgreSQL limited to
      localhost; firewall 80/443 for caddy.exe on private networks only; backup task 6:15 pm Mon-Sat (runs late if the
      PC was off); checks HTTPS and the admin sign-in, then removes the admin password from `.env`
- [x] HTTPS: option B (default) Caddy `tls internal` + `trust-certificate.ps1` per PC (compare the fingerprint, type its
      last 4 characters; `-Remove`); option A Let's Encrypt via Cloudflare DNS (Caddy's official build with the
      Cloudflare module; no published checksum, its SHA-256 is logged); `set-hosts.ps1` per PC + router DNS instructions
- [x] `update.ps1`: checks the release (folder or zip) -> stops -> backs up -> swaps -> starts (migrations) -> health
      check on the new version -> on failure rolls back the app and, if the migrations changed, the database
- [x] `backup.ps1` / `restore.ps1`: pg_dump + uploads archive into a `.partial` folder, checked (`pg_restore --list`,
      `tar -t`, manifest with SHA-256), then renamed; keeps N days (always the newest 3); optional second copy
      (`BACKUP_COPY_DIR`); restore checks checksums, typed RESTORE, stops the app, safety backup (typed CONTINUE if the
      current data cannot be backed up), replaces the database in one transaction, swaps the uploads folder
- [x] `uninstall.ps1`: removes services, task, firewall rule, hosts line, certificate trust and `C:\hirefolios`; keeps
      data, database and backups unless `-RemoveData` / `-RemoveBackups` (typed DELETE); `-RemovePostgreSQL` only if
      install.ps1 installed it; kept settings move to `C:\hirefolios-data\config` for a later reinstall
- [x] `docs/INSTALL.md` rewritten for a non-developer (shopping list, install, each PC, webcam, TV, daily use, backups,
      restore, update, uninstall, troubleshooting); `docs/FIRST-DRIVE-CHECKLIST.md` and CLAUDE.md updated

### Verification (Phase 3 features, before the Windows install work)

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

### Verification (Windows install, 2026-11-11, on the dev PC)

- `tsc`, `eslint` clean; vitest 127/127; production build via `npm run package`; `npm run dev:check` 13 pages
- Packaged server (release folder) on a scratch PostgreSQL 16.15: smoke 85/85; Playwright 21 passed, 1 skipped (the
  plain-http LAN test needs the LAN address), including the new manual-only test
- PSScriptAnalyzer 1.24: 0 findings with `deploy/windows/PSScriptAnalyzerSettings.psd1`, which excludes, with reasons,
  Write-Host (interactive console scripts), ShouldProcess on internal helpers, and the plain-text password parameter
  warnings (the value comes from the ACL-protected `.env`)
- Without admin (scratch install folder): backup 15/15 (incl. 5 backups killed mid-run: never a complete-looking broken
  backup, `.partial` refused by restore and cleaned after a day, pruning keeps the newest 3); restore 16/16 (wrong word
  cancels, damaged archive refused, unreadable current data needs CONTINUE, tables of a newer version removed);
  smoke 85/85 after the restore
- **Full install on this PC** (test locations `C:\hirefolios-test*`, address `hf-test.hirefolios.in`, option B), with
  the owner's OK: install (PostgreSQL via winget), re-run after an interrupted install, re-run with nothing asked;
  smoke 85/85 over HTTPS 6 times; Playwright 21 passed over HTTPS with the live (fake) webcam; app / service wrapper /
  Caddy killed -> back by themselves; all services stopped and started in boot order; update to a dummy 0.1.1;
  crashing release -> rolled back (database untouched); release whose migration applies and then fails the health
  check -> rolled back including the database; update from the zip; backup -> all tables dropped and uploads emptied
  -> restore -> counts back, smoke 85/85; scheduled task run as SYSTEM; port 443 taken -> clear message, nothing
  changed; wrong / right `postgres` password; admin password too short / bad email / nothing typed -> clear errors,
  settings unchanged. Final test run: 54 checks passed, 2 failed (issues 19 and 20 below)
- Uninstall + before/after comparison: services, PostgreSQL (program, port 5432), firewall rule, hosts file
  (same SHA-256), Trusted Root (same list), task, test folders, ports 80/443: all back as before; `C:\hirefolios-data`
  untouched. Left until the next restart: the two service accounts' empty profiles, PostgreSQL's empty registry keys,
  and two "Windows PowerShell" firewall rules Windows made for the port-443 test listener (cleanup script for after
  the restart)

### Issues found while testing (logged before fixing; re-tested)

| # | Issue | Severity | Fix |
|---|---|---|---|
| 1 | `next build` copies this PC's `.env` into the standalone output: a release would have carried dev secrets | major | package deletes `app/.env*`; a secret scan fails the package otherwise |
| 2 | Git's GNU `tar` in PATH reads `C:\...` as a remote host: zip and backups failed | blocker | always `%SystemRoot%\System32\tar.exe` |
| 3 | ESLint / tsc scanned `release/` (1,136 errors) | minor | ignored / excluded |
| 4 | Restore stopped when the current data could not be backed up (the usual reason to restore) | blocker | warn, typed CONTINUE |
| 5 | Restore took its safety backup before stopping the app | minor | stop first |
| 6 | After a restore the status card lost the last-backup time | minor | `.last-backup` carried over |
| 7 | A backup killed while another waited: `AbandonedMutexException` | minor | treated as acquired |
| 8 | `-ServiceName ""` impossible from a command line (PowerShell 5.1 drops empty arguments) | major | `-NoService` switch |
| 9 | A wrong `-PostgresSuperuserPassword` fell through to a prompt (an unattended install would hang) | minor | clear error |
| 10 | `Read-Host` returns null without console input: install crashed at the "network is Public" question | major | null-safe `Read-Answer` everywhere |
| 11 | `$PSScriptRoot` is empty in `param()` defaults under `-File`: update / backup / restore and the scheduled backup failed without `-InstallDir` | blocker | default set in the script body |
| 12 | Generated secrets (PostgreSQL superuser, DB login) were saved only at the end: an install that stopped half way lost them | blocker | saved to `.env` before they are used |
| 13 | The zip had a top folder: "Extract All" made `hirefolios-0.1.0\hirefolios-0.1.0` and the guide's first command failed | major | zip contents at its root |
| 14 | Uninstall stopped half way: a service profile is "in use" right after the service stops | major | at the end, retried, never fatal |
| 15 | `-ConfirmWords A,B` arrives as one string under `-File` | minor | split on commas |
| 16 | PostgreSQL's uninstaller leaves its folder and empty registry keys | minor | removed when install.ps1 installed it (folder: re-tested; registry part written after the last run) |
| 17 | Windows PowerShell 5.1 on older Windows 10 may offer only TLS 1.0 | minor (preventive) | TLS 1.2 enabled in common.ps1 |
| 18 | PSScriptAnalyzer: unused variable, plural nouns; CLAUDE.md command block had broken characters | minor | fixed |
| 19 | A password passed as `-AdminPassword` on a command line ends up in the install log header (Administrators-only folder) | major | `-AdminPassword` and `-PostgresSuperuserPassword` removed (passwords only at the masked prompt); install.ps1 ends by scanning every file in `logs\` for each secret in `.env` and the admin password, and replaces any hit by `[removed]` (unit check 6/6; full install not re-run) |
| 20 | (test check) "data kept" compared audit row counts; the deletion job adds an audit row at every start | none | not a product issue |

### Known issues / left open after Phase 3

- **Left for the office PC** (could not be tested on the dev PC): a real restart / power cut (services were killed,
  stopped and started, not rebooted); other PCs on the LAN (`set-hosts.ps1`, `trust-certificate.ps1 -Server`, the
  webcam from the HR desk PC over HTTPS; the dev PC's Wi-Fi is a Public network, so the Private-only firewall rule was
  not exercised); a person typing at the prompts (masked password, mismatch retry; tested with parameters and empty
  input); `-PostgresInstaller` without internet; option A (no Cloudflare token); a real USB drive as `BACKUP_COPY_DIR`.
- Uninstall leaves the two service accounts' empty Windows profiles (`C:\Windows\ServiceProfiles\hirefolios*`) until
  the next restart (Windows holds them); its warning prints the one-line command to remove them afterwards.
- A rollback restores the database from the pre-update backup only when the migrations changed; files the failed
  version's deletion job removed in that minute are not put back (their rows are purged again anyway).
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

## Phase 3.5 — No hard-coding, real dev database, office compatibility ✅ (2026-11-12)

- [x] **Hard-coded audit** of `src/` (lists, labels, numbers, company names, ports, paths, URLs, time zones, limits): every
      business value moved to the database, every machine value to `.env`; what stays in code is documented (enum labels,
      SSE retry, JPEG size caps, the IST constant, the product name in `brand.ts`, the seed source `options.ts`)
- [x] Migration `0005_lists_notice_company` (adds only; one data fix: the unused seeded token prefix `SB` → `A`, which
      tokens always showed): `option_items`, `privacy_notices` (+ `consents.notice_id`), company columns on `tenants`
- [x] **Lists in the database** per tenant (certifications, coding specialties, EHR / PM software, education, notice
      periods, sources, languages): label, in use, order, "sample" mark; seeded from `options.ts` the first time a tenant
      needs them. **Settings → Lists**: add, rename, reorder, retire (never delete); audited (ids + list only). Intake,
      intake prefill, search filters (retired items still offered, marked), job required certifications and the profile /
      interview notice labels all read the database; the server validates against the active items
- [x] **Privacy notice versions** per tenant: EN + HI templates with `{company} {photoDays} {dataDays} {contact}`, effective
      date, draft / active / retired, contact person (name + email / phone, required to publish). **Settings → Privacy
      notice**: start a draft from the version in use, edit, preview EN / HI, publish (old version read-only), discard.
      Intake shows the active version; consents keep `notice_version` and `notice_id`. The starting text is exactly the old
      `draft-2026-11-10`, so earlier consents still name the text they were shown
- [x] **Company profile**: name, short name, token prefix (tokens `<prefix>-001`), office address, time zone (stored; IST
      only for now), logo (PNG / JPEG / WebP by bytes, 1 MB, never SVG; `GET /api/company/logo` for signed-in staff of
      the tenant, TV included). **Settings → Company**. Shown in the header, on the lobby TV, in the notice and in Excel
      exports (workbook company, print header, a "Company" sheet with the logo)
- [x] **Configuration**: `src/lib/config.ts` zod-checks every machine value at start-up (DATABASE_URL, PORT, HOSTNAME,
      UPLOAD_DIR, BACKUP_DIR, BACKUP_STATUS_FILE, BETTER_AUTH_URL / SECRET / TRUSTED_ORIGINS, STAFF_SESSION_HOURS,
      DISPLAY_SESSION_DAYS, MAX_UPLOAD_MB, MAX_CV_FILES, MAX_CV_PAGES, PURGE_JOB, PURGE_INTERVAL_MINUTES, OFFICE_HOURS,
      RUN_MIGRATIONS, MIGRATIONS_DIR, SEED_ON_START, APP_VERSION); a bad value stops the server naming the variable.
      Documented in `.env.example` and docs/INSTALL.md section 17. The deletion job can wait outside office hours
- [x] **Version pinning**: `deploy/windows/versions.json` (Node.js 24, PostgreSQL 16, Caddy 2.11.9, WinSW 2.12.0 with
      SHA-256) read by install / update / check-machine (common.ps1), `npm run package`, the app's start-up check and a unit
      test that keeps `package.json` engines in step. The app refuses another Node.js or PostgreSQL major with a plain
      message; update.ps1 refuses a release whose pins do not match the PC
- [x] **Demo data** only on request: `npm run demo:seed` (separate "demo" tenant, 12 "Sample candidate NN", demo admin
      with DEMO_ADMIN_PASSWORD from .env), `npm run demo:clear`; refuses NODE_ENV=production; not in releases
- [x] **Permanent dev database**: PostgreSQL 16.15 (winget, same package as the office) as service `postgresql-x64-16`,
      automatic, localhost:5432, database + login `hirefolios_dev` (passwords only in .env), via `scripts/dev-postgres.ps1`;
      `npm run db:check`
- [x] **Office compatibility**: `deploy/windows/check-machine.ps1` (no admin, changes nothing; PASS / WARN / FAIL with the
      fix; report file on the Desktop); "please use Chrome or Edge" banner for other browsers; `npm run lint:ps`
      (PowerShell 5.1 parse, `"$name:"` traps, ASCII, PSScriptAnalyzer)
- [x] Docs: INSTALL.md step 0 (check-machine), Settings to fill in before going live, settings-file reference;
      first-drive checklist; CLAUDE.md (patterns, dev database, commands)

### Verification (Phase 3.5, against the permanent local PostgreSQL 16.15)

- `tsc`, `eslint` clean; vitest 161/161 (new: config errors per variable, office hours, pinned versions, browser rule,
  retired / renamed list items, notice rendering and publish checks); `npm run db:check` 4/4; production build and
  `npm run package` (2,251 files, no source / env files, 4 secrets checked); `npm run dev:check` 16 pages
- `npm run smoke` 85/85; Playwright 27 passed, 1 skipped (plain-http LAN address) in Chrome 157, twice in a row, incl. the
  new settings-data spec (admin renames a certification, adds an EHR, retires a source and a certification, moves an
  item; intake, server validation, search filters, profile and prefill follow; publishes a Hindi notice fix with a contact;
  old consent keeps its version; company name / short name / prefix `T` / logo in header, TV, token `T-001` and Excel; SVG
  logo refused; another tenant's item hidden and its update → 404) and the browsers spec; Edge 157: 7 passed
- Real server start-ups (11/11): missing variables, relative UPLOAD_DIR, non-postgres URL, bad session hours, wrong
  password (reason shown, password never printed), PostgreSQL not running → each stops with a named reason; fresh empty
  database → 6 migrations, 83 list items, starting notice, prefix A; PostgreSQL restarted, stopped (health 503, sign-in
  page still loads) and started again while the app runs → it recovers by itself (scratch PostgreSQL 16 cluster, no admin)
- `check-machine.ps1` on this laptop: 0 FAIL, 3 WARN (Public Wi-Fi, DHCP address, Wi-Fi instead of a cable); PSScriptAnalyzer
  0 findings on 11 scripts (positional-parameter rule excluded for the report helper, reason in the settings file)
- Screenshots of Settings → Lists, Privacy notice, Company and intake details at 1440, 1366x768, 1024 reviewed (outside the repo)

### Issues found while testing (logged before fixing; re-tested)

| # | Issue | Severity | Fix |
|---|---|---|---|
| 1 | A `.env` with no UPLOAD_DIR line at all passed the check (zod skips a missing key whose schema is optional-like) | major | plain required string; unit test |
| 2 | Wrong DATABASE_URL password: start-up said "Failed query: select ..." (drizzle's wrapper), not why | major | message from the driver error |
| 3 | PostgreSQL down: the reason was empty (refused on ::1 and 127.0.0.1 = AggregateError with no message) | minor | inner error / code used |
| 4 | check-machine.ps1 did not parse: `"$pgMajor:"` read as a drive variable (the trap fixed before, repeated) | blocker | `${pgMajor}:`; new `npm run lint:ps` catches the pattern in every script |
| 5 | Product / company name, domain and a path written in code messages (start-up error, config examples, two hints) | minor | `brand.name`, neutral examples, "your HR team" |
| 6 | Settings → Lists: after renaming, the row remounted and the "Saved." message vanished | minor | rows keyed by id |
| 7 | Notice editor preview stayed in English while editing Hindi | minor | preview follows the edit language |
| 8 | Header wrapped to two rows at 1366 / 1024 with the new company block | minor | company name under the product name, logo beside |
| 9 | After publishing a notice the confirmation disappeared with the editor | minor | "In use at intake: <version> since <date>" always shown |
| 10 | Release secret scan checked 3 named .env keys (not DEV_PG_SUPERUSER_PASSWORD / DEMO_ADMIN_PASSWORD) | minor | every SECRET / PASSWORD / TOKEN / KEY value |
| 11 | e2e cleanups did not remove the per-tenant lists / notice: FK error, 2 test tenants left in the dev database | minor (tests) | cleanups updated, leftovers removed |
| 12 | check-machine printed "C::" | minor | wording |

### Known issues / left open after Phase 3.5

- **Simplen must confirm in Settings before going live:** Company (name, short name, token prefix, address, logo);
  Lists (all seven, marked Sample); Privacy notice (legal check of EN / HI, native Hindi check, contact person, publish);
  plus the jobs, rounds, reject reasons and retention periods from earlier phases.
- Time zone is stored per tenant but the app runs on IST only (hard rule 7); per-tenant zones arrive with the SaaS phase.
- Renaming a list item does not rewrite older candidates (they keep the wording they were saved with; search still finds
  them by full text, and retired items stay in the filters).
- Browser support was tested on Chrome 157, Edge 157 and Playwright's Chromium 158; an older Chrome / Edge major was not
  available offline. The banner lets Chromium browsers ≥ 120 through and warns on Firefox / Safari / older.
- The Node.js / PostgreSQL major guard was tested with unit tests (no second Node or PostgreSQL major on this laptop).
- Restarting the permanent dev PostgreSQL *service* needs admin; the same restart / stop / start behaviour was tested on a
  scratch PostgreSQL 16 cluster.
- The headless fake webcam still fails to start now and then (once in the full suite here); the intake test then uses the
  upload fallback or fails at the webcam picker; a re-run passes.
- Still open from earlier phases: office-PC-only checks (reboot, LAN, real webcam), `npm audit` items in build tools,
  staff emails unique across tenants, in-memory sign-in rate limit, `update-user` rename, in-process live-update bus.

## Phase 3.6 — Candidate 360 + rediscovery (in progress, spec: docs/REDISCOVERY.md)

- [x] **A** — spec (`docs/REDISCOVERY.md`); migration `0006_rediscovery` (adds only, backfills reason / visit categories;
      backfill checked on the dev database with a throwaway tenant); `tenant_settings` + Settings → Rediscovery (sample
      values, limits, audited); reject categories + rediscovery tags as Settings → Lists (codes + kinds; system tags can't be
      retired); category per reject reason (editor column); category + cost figures on interview reject, manager override and
      declined offer; other offers in hand (intake "More details", profile, history); hiring summary engine
      (`src/lib/rediscovery/summary.ts`) + `GET /api/candidates/[id]/summary`; permissions `rediscovery`, `contactUnblock`
- [x] **B** — tags (history, notes, remove with a note), suggestion rules (`suggest.ts`: Good but high cost, near-miss; inclusive
      threshold; never joined / Do not rehire / skill rejections / no scores), accept / dismiss (remembered per decision),
      `/dashboard/suggestions`, HR-only Do not rehire warning at intake lookup, score change between visits (`trend.ts`), profile
      Summary card (summary line, visits at a glance, tags, suggestions); e2e `rediscovery.spec.ts`
- [x] **C** — header quick-look (HR / manager / admin; typo-tolerant names, 4+ mobile digits, 8 rows with summary line, score
      change, tags; "/" focus, arrows, Enter, Esc; combobox ARIA; `GET /api/quicklook`), trigram index on mobile, profile Summary card
      (who they are, visits at a glance, score change, data kept / deletes on), `scripts/perf-rediscovery.ts` (10k candidates:
      quick-look 108 ms typo name, 100 ms 2 letters, 12 ms 4 digits)
- [x] **D** — contact log (Call `tel:+91`, WhatsApp `wa.me` click-to-chat with EN / HI templates, Mark contacted; purpose,
      outcome, note), soft cooling warning (IST days), WhatsApp only with consent, Do not contact (admin clears with a note),
      call-backs (default date = decision + notice days, `/dashboard/callbacks`, dashboard card, snooze / done, quick-look chip),
      consent recorded after the visit / renewed / withdrawn (deletion dates cleared / restarted from the withdrawal day), talent
      pool keep period in the deletion job (`planPurge` + `candidateErasable`), Settings dry run of pool candidates expiring in
      30 days
- [x] **E** — `/dashboard/pool` (tagged people; 15 URL filters, 4 sorts, 25 per page, Do not contact hidden unless asked,
      withdrawn consent never shown, Excel export), `/dashboard/bulk` (sources, always-excluded counts, transparent ranking
      `rank.ts` with weights from Settings, "why" per row, "already in push X"), hiring pushes (`/dashboard/pushes`, per-person
      status, progress, contact with purpose bulk push, Excel export), set-based base query (10k candidates: pool 99–229 ms,
      bulk 324 ms)
- [x] **F** — joining-risk hints (`risk.ts`; profile, drive board Selected list, `/dashboard/joining`; codes saved with the offer),
      Reports → Rediscovery (why not hired by category / position, cost gap, pool by tag, suggestions accepted vs dismissed,
      call-backs, push funnel, hints vs outcome), demo seed (cost rejections, near-miss, returning candidate, call-backs due,
      offer with hints, push), docs (`REDISCOVERY.md` final, `HR-GUIDE-REDISCOVERY.md`, CLAUDE.md, first-drive checklist)

## Phase 4 — next

Manual entry by HR stays available at every step (CLAUDE.md hard rule 13; `e2e/manual-intake.spec.ts` must keep passing).
Everything below is an optional helper on top of it.

- [ ] QR one-time candidate self-fill + CV upload: HR shows a one-time QR code; the candidate fills their details and
      uploads their CV from their own phone, through a Cloudflare Tunnel (free) to the office server; link expires
      after use / a short time; HR reviews everything before saving
- [ ] Rule-based CV auto-fill as the backup when the candidate does not self-fill (offline, no paid APIs, no AI/OCR
      services: text from PDF / .docx only, patterns for name, email, mobile, experience, certifications)
- [ ] Intake reorder: Mobile → CV → Details (so self-fill / auto-fill can prefill the details)
- [ ] Field markers "from CV" / "from candidate" next to pre-filled values; every pre-filled field stays editable
- [ ] Photo flag "uploaded, not live" when the photo came from a file instead of the webcam
- Later: tenant onboarding and settings for other companies (SaaS), merge possible duplicates
