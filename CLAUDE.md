# Hirefolios — notes for Claude and developers

Walk-in recruitment system for Simplen Billing e-Services (medical billing / RCM).
PC-based: HR registers each walk-in on an office PC with a webcam (details, live photo, CV files
or webcam photos of a paper CV); HR turns the screen and the candidate only reads the notice and
taps consent. Interviewers, managers and the lobby TV use other office PCs in a browser.
Standalone (not part of SESS). Runs natively on one Windows 10/11 office PC as three Windows services
(PostgreSQL 16, the app's Node.js standalone server via WinSW, Caddy for HTTPS) at
https://simplen.hirefolios.in; later sold to other companies as SaaS. No Docker for Simplen.

Read `PROGRESS.md` first and continue from where it stops.

## Hard rules

1. **No paid APIs.** No AI, SMS, WhatsApp API, OCR or hosted auth services. Everything runs on the office PC.
2. **Tenant isolation.** Every business table has `tenant_id`. Every query filters on the signed-in staff member's `tenantId`, server-side. Never take a tenant id from the client.
3. **Files are never public.** Photos and CV pages live under `UPLOAD_DIR` (an absolute path; in dev the gitignored `/data/uploads`), outside `public/`, and are served only through `GET /api/files/[id]`, which checks the signed-in staff member's tenant.
4. **Consent before camera.** No photo or CV page may be captured until a `consents` row exists for that candidate.
5. **No Aadhaar at intake.** Do not add an Aadhaar field, photo or OCR anywhere in intake.
6. **Under-18 blocked.** Intake refuses candidates younger than 18 (age computed on the IST calendar date).
7. **IST dates.** Dates shown to staff are Asia/Kolkata (`APP_TIME_ZONE` in `src/lib/ist.ts`, the only place it is written). Calendar days (token day, drive day) are IST `date` columns.
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
| `src/lib/options.ts` | **Seed source only**: the starting pick-lists, reject reasons, sample criteria; plus code labels for enum values (outcomes, decisions) |
| `src/lib/lists.ts`, `src/lib/lists-db.ts` | Pick-lists per tenant in `option_items` (Settings → Lists): types (browser-safe) and DB access (`getOptionLists`, per-request cache; a tenant without items gets the defaults, marked sample). Intake / filters / jobs validate against them |
| `src/lib/intake.ts` | Shared intake rules (client + server): `normalizeMobile`, age, zod `IntakeRequest` |
| `src/lib/notice.ts`, `src/lib/notice-db.ts` | Privacy notice: starting text + placeholders `{company} {photoDays} {dataDays} {contact}` + renderer (browser-safe); versions per tenant in `privacy_notices` (one active, one draft, published never edited; consents keep `notice_version` + `notice_id`) |
| `src/lib/company.ts` | Company profile (Settings → Company): name, short name, token prefix, address, time zone (IST only for now), logo under `UPLOAD_DIR` served by `GET /api/company/logo` |
| `src/lib/config.ts` | Every machine-specific value from env, zod-checked at start-up (`config()`, `uploadLimits()`, `inOfficeHours`); a bad value stops the server naming the variable |
| `src/lib/runtime-check.ts`, `deploy/windows/versions.json` | Pinned Node.js / PostgreSQL majors (+ Caddy, WinSW): the app refuses others; install / update / package / `engines` follow the same file |
| `src/lib/browser.ts`, `src/components/browser-notice.tsx` | "Please use Chrome or Edge" banner for other browsers |
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
| `docs/REDISCOVERY.md`, `docs/HR-GUIDE-REDISCOVERY.md` | Phase 3.6 spec (source of truth) and the HR guide |
| `src/lib/rediscovery/` | Candidate 360 + rediscovery. Pure, unit-tested rules: `settings.ts` (seed values + limits of Settings → Rediscovery), `categories.ts` (reject categories, tags, cost gap), `summary.ts` (hiring summary), `suggest.ts`, `trend.ts` (score change), `contact.ts` (cooling, templates, wa.me / tel:, call-back dates), `rank.ts` (bulk ranking, push statuses), `risk.ts` (joining-risk hints). Server: `settings-db.ts`, `data.ts` (loads histories, tags, insights, contact state, risks), `actions.ts` (every write, audited), `pool.ts` (pool + bulk lists, set-based base query), `quicklook.ts`, `callbacks.ts` |
| `src/app/(staff)/dashboard/{pool,bulk,pushes,suggestions,callbacks,joining}`, `settings/rediscovery` | Rediscovery pages (HR, manager, admin) and Settings → Rediscovery (admin) |
| `src/app/api/candidates/[id]/rediscovery`, `.../summary`, `api/quicklook`, `api/pushes`, `api/settings/rediscovery` | Rediscovery APIs (one action route per candidate) |
| `src/components/header.tsx`, `nav-menu.tsx`, `user-menu.tsx` | One-row header: per-role visible links + "Rediscovery ▾" / "Admin ▾" (or "More ▾") menus (`headerNav`), keyboard-accessible menu button, account menu (change password, sign out). A new page gets a menu entry here, with its permission |
| `src/components/quick-look.tsx`, `rediscovery.tsx`, `contact.tsx`, `person-contact.tsx`, `reject-fields.tsx` | Header quick-look, tags / suggestions, contact / call-back / consent / do-not-contact controls, reject category + cost fields |
| `scripts/perf-rediscovery.ts` | 10,000-candidate timing of quick-look, pool, bulk list (throwaway tenant, deleted after) |
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
| `scripts/dev-postgres.ps1`, `scripts/db-check.ts` | Dev PC: permanent PostgreSQL 16 service + dev database (admin, once); `npm run db:check` |
| `scripts/demo-seed.ts` | `npm run demo:seed` / `demo:clear`: a separate "demo" tenant with sample candidates, on request only |
| `scripts/lint-ps.ps1` | `npm run lint:ps`: parse every .ps1 as Windows PowerShell 5.1, `"$name:"` traps, ASCII only, PSScriptAnalyzer |
| `deploy/windows/check-machine.ps1` | Office PC readiness check (no admin, changes nothing): PASS / WARN / FAIL + report file |
| `e2e/` | Playwright tests (two fake webcams, desk sizes 1440 / 1366x768 / 1024); `manual-intake.spec.ts` = hard rule 13 |
| `scripts/package.mjs` | `npm run package [-- --version X]`: `release/hirefolios-<version>/` + `.zip` (standalone app, static, migrations, bundled `node.exe`, `VERSION.txt` + `release.env`, scripts, pinned tools, docs; no source, no `.env`, scans for this PC's secrets) |
| `deploy/windows/` | Office PC: `install.ps1`, `update.ps1` (auto rollback), `backup.ps1`, `restore.ps1`, `uninstall.ps1`, `trust-certificate.ps1` + `set-hosts.ps1` (each office PC), `common.ps1` (shared helpers, **pinned WinSW + Caddy versions and SHA-256**), Caddyfile templates (B: `tls internal`, A: Cloudflare DNS), WinSW service XML, `PSScriptAnalyzerSettings.psd1` |
| `deploy/docker/` | Optional, for future cloud / SaaS only. Not used for Simplen, not maintained or tested |
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
- Pick-list values are stored on candidates as their text. The lists live per tenant in `option_items` (Settings → Lists);
  read them with `getOptionLists(tenantId)`, validate with `makeIntakeDetails(lists)` / `makeJobInput(...)`. Items are never
  deleted, only retired. `options.ts` only seeds new tenants. Never hard-code a business list, company name, port, path or URL.
- The privacy notice shown at intake is `getActiveNotice(tenantId)`; edits go to the draft and publish as a new version
  (`notice-db.ts`). Company name / logo / token prefix come from `getCompany(tenantId)`; the product name stays in `brand.ts`.
- Machine-specific values: add them to `ConfigSchema` (`src/lib/config.ts`), `.env.example` and docs/INSTALL.md section 17; read
  them with `config()`, never `process.env` directly (except `DATABASE_URL` in `src/db/index.ts`).
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
- Rediscovery (Phase 3.6): rules use list item **codes** (`option_items.code`), never labels. Every automatic label is a
  suggestion until a person accepts it, and shows its reason. HR-only data (tags, do not rehire / contact, contact log, call-backs,
  cost figures, other offers, risk hints) needs the `rediscovery` permission and never reaches the consent screen, the TV or
  interviewers (except the hiring summary of a candidate they interviewed). Tags never keep data; talent-pool consent does,
  for `talent_pool_keep_months`. New Phase 3.6 tables cascade with their tenant and candidate.
- Rediscovery writes go through `src/lib/rediscovery/actions.ts` inside `act()`; thresholds come from `getSettings(tenantId)`.

## Commands

```bash
cp .env.example .env          # then fill BETTER_AUTH_SECRET, UPLOAD_DIR and SEED_ADMIN_*
# once, PowerShell as Administrator: permanent PostgreSQL 16 service (port 5432) + hirefolios_dev; writes DATABASE_URL to .env
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-postgres.ps1
npm install
npm run db:check              # connects, PostgreSQL 16.x, migrations up to date, pg_trgm (dev DB = the service above;
                              # embedded-postgres / scratch clusters only for throwaway test databases)
npm run db:migrate
npm run db:seed
npm run dev                   # http://localhost:3000

npm run typecheck && npm run lint && npm test
npm run dev:check             # starts next dev (own port/folder), loads key pages, fails on dev-only build errors
npm run build && npm start    # standalone server (node .next/standalone/server.js)
npm run test:e2e              # needs the DB seeded and a server; PW_CHANNEL=chrome, E2E_BASE_URL, optional E2E_LAN_URL
npm run smoke                 # API smoke test against SMOKE_BASE_URL (default http://localhost:3000)
npm run db:generate -- --name=<change>   # after editing schema.ts
npm run demo:seed             # sample data in a separate demo tenant (needs DEMO_ADMIN_PASSWORD in .env); demo:clear removes it
npm run lint:ps               # PowerShell scripts (run after editing deploy/windows or scripts/*.ps1)

# Production (office PC, Windows, see docs/INSTALL.md)
npm run package               # -> release/hirefolios-<version>/ and .zip (copy to the office PC)
# on the office PC, PowerShell as Administrator, in the unpacked release folder:
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File C:\hirefolios\scripts\update.ps1 -From <new release folder or .zip>
powershell -NoProfile -ExecutionPolicy Bypass -File C:\hirefolios\scripts\backup.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File C:\hirefolios\scripts\restore.ps1 -From C:\hirefolios-backups\<folder>
# lint the scripts (PSScriptAnalyzer module):
Invoke-ScriptAnalyzer -Path deploy\windows -Settings deploy\windows\PSScriptAnalyzerSettings.psd1
```

`UPLOAD_DIR` must be an absolute folder (the standalone server runs from `.next/standalone`, which
a build wipes). To build while `next dev` is running, use `NEXT_DIST_DIR=.next-verify npm run build`
and start `.next-verify/standalone/server.js` (both write to `.next` otherwise).

Other PCs reach the server PC at https://simplen.hirefolios.in (local DNS → its LAN address; Caddy terminates
HTTPS); same-origin sign-in also works from any address the PC answers on (e.g. `http://192.168.1.20:3000` in dev).
Browsers only allow the live webcam on `https://` or localhost; elsewhere the intake offers "Upload a photo file instead".
Behind a reverse proxy, forward `X-Forwarded-Host`/`X-Forwarded-Proto` (Caddy does) or list the public origin in
`BETTER_AUTH_TRUSTED_ORIGINS`.
