# Candidate 360 + Rediscovery (Phase 3.6) — specification

Source of truth for Phase 3.6 (sub-phases A–F). Code follows this file; when they differ, fix one of them.

Goal: HR types a name and sees a past candidate's whole story in seconds (who they are, every visit, how the
interviews went, hired or not and exactly why), keeps strong people who were turned away for non-skill reasons in
tagged pools, and builds a ranked call list when bulk work arrives — contacting people politely, at the right time,
with their consent. Everything is rule-based (no AI, no paid APIs) and optional for HR. Every automatic label is a
**suggestion** until a person accepts it, and always shows the reason behind it.

## Ground rules

- Nothing new is required at intake or in interviews. The only required input is the reject reason that already existed.
- `tenant_id` on every new table; every query filters on the signed-in staff member's tenant.
- Every default lives in the database per tenant (`tenant_settings`, `option_items`) and is editable in Settings,
  seeded with clearly marked **sample** values. `src/lib/rediscovery/settings.ts` and `src/lib/options.ts` are the
  seed source only.
- HR-only information (tags, do-not-rehire, do-not-contact, notes, contact log, call-backs, risk hints, cost figures)
  never appears on candidate-facing screens (consent screen, lobby TV) and is not shown to interviewers.
- Audit rows hold ids, codes and counts only (CLAUDE.md hard rule 11).
- Retention first: tags never keep data past retention. Only talent-pool consent does, within the keep period.
- Business rules live in pure, unit-tested modules under `src/lib/rediscovery/`; pages and APIs only call them.

## Data model (migration `0006_rediscovery`, adds only)

| Table / column | What |
|---|---|
| `option_list` enum + `reject_category`, `rediscovery_tag` | two new lists in Settings → Lists |
| `option_items.code` | stable key of an item (`cost`, `do_not_rehire`, …). Rules use codes, so renaming is safe. Items HR adds get a generated code |
| `option_items.kind` | reject categories only: `skill` · `non_skill` · `neutral` |
| `reject_reasons.category_code` | the reason's category (editable in the reject reasons editor); backfilled |
| `applications.reject_category` | category of the decision (rejected, offer declined, no-show / walked away); backfilled |
| `applications.cost_expected_ctc`, `cost_budget_ctc` | cost decision figures, whole rupees per year (budget = offered CTC for a declined offer) |
| `applications.risk_hints` | joining-risk hints (codes) saved when an offer is recorded, for the "hints vs outcome" report |
| `tenant_settings` | key → JSON value per tenant, `sample` flag, who / when |
| `other_offers` | other offer in hand: company, offered CTC, joining date, noted date (history; latest shown) |
| `candidate_tags` | tag code, note, source (`manual` / `suggestion`), added by / at, removed by / at / note (history) |
| `suggestion_dismissals` | candidate + tag + the decision (application id + decided time) it was dismissed for |
| `contact_log` | channel, purpose, outcome, note, by, at (optionally the hiring push) |
| `do_not_contact` | reason, set by / at; cleared by / at / note (admin only) |
| `callbacks` | due date, note, open / done, outcome, done by / at |
| `consents.channel`, `consents.note` | consent recorded after the visit (`in_person`, `whatsapp`, `phone`, `email`; intake rows stay null) |
| `hiring_pushes`, `push_members` | saved bulk lists: criteria, per-person status, rank, score, reason |
| index `candidates_mobile_trgm_idx` | partial-mobile search for the quick-look |

New tables reference `tenants` and `candidates` with `on delete cascade` and staff with `on delete set null`, so the
deletion job (`eraseCandidateRows`) and tenant clean-ups remove them with the candidate.

### Backfill

- Sample reject reasons get a category by label (table below); any other reason → `other`.
- Rejected visits get the category of their reason (unknown → `other`); no-show / walked-away visits → `no_show`.
- Nothing is dropped or renamed.

## Settings → Rediscovery (`tenant_settings`, sample until saved)

| Key | Default | Limits | Meaning |
|---|---|---|---|
| `score_threshold` | 3.5 | 1–5 | "Strong" average interview score (of 5) for suggestions and ranking |
| `contact_cooling_days` | 30 | 0–365 | Contacted fewer days ago than this → soft warning before contacting again |
| `talent_pool_keep_months` | 24 | 1–60 | Talent-pool candidates are kept this long after their last visit or consent renewal |
| `callback_default_days` | 30 | 1–365 | Call-back date when the candidate has no notice period (else decision day + notice days) |
| `risk_other_offer_on` | on | — | Hint: other offer in hand |
| `risk_notice_on`, `risk_notice_days` | on, 60 | 0–365 | Hint: notice period ≥ days |
| `risk_ctc_on`, `risk_ctc_gap_percent` | on, 15 | 0–200 | Hint: expected CTC above offered by ≥ % |
| `risk_joining_on`, `risk_joining_days` | on, 30 | 0–365 | Hint: joining date more than days away |
| `risk_city_mismatch` | off | — | Hint: candidate city ≠ office city |
| `office_city` | (empty) | 0–100 chars | Office city for the hint above (empty = hint off) |
| `bulk_recency_months` | 24 | 1–120 | Bulk lists look at people whose last visit is this recent |
| `bulk_over_budget_percent` | 10 | 0–100 | Up to this % over budget is listed lower with "+x% over budget"; more is excluded |
| `rank_weight_budget` … `rank_weight_recency` | 30 · 25 · 20 · 10 · 5 · 10 | 0–100 each | Ranking weights (budget fit, score, skills match, shift fit, improvement, recency) |
| `wa_bulk_en/hi`, `wa_callback_en/hi`, `wa_consent_en/hi` | texts below | 1–1000 chars | WhatsApp templates, placeholders `{name} {company} {position} {hr_name}` |

Every change is validated (zod, limits above) and audited (`settings.update`, keys only).

### WhatsApp templates (sample — Simplen HR to confirm; Hindi needs a native-speaker check)

- Bulk opening EN: `Hello {name}, this is {hr_name} from {company}. We have new openings for {position}. You visited us before and we would like to invite you again. Reply here or call us if you are interested.`
- Bulk opening HI: `नमस्ते {name}, मैं {company} से {hr_name} बोल रहा/रही हूँ। हमारे यहाँ {position} के लिए नई जगहें खुली हैं। आप पहले हमसे मिल चुके हैं, हम आपको फिर से बुलाना चाहते हैं। रुचि हो तो यहीं जवाब दें या हमें कॉल करें।`
- Call-back EN: `Hello {name}, this is {hr_name} from {company}. As discussed during your visit, we are getting back to you about the {position} role. Is this a good time to talk?`
- Call-back HI: `नमस्ते {name}, मैं {company} से {hr_name}। आपकी पिछली मुलाक़ात में हुई बात के अनुसार हम {position} की नौकरी के बारे में संपर्क कर रहे हैं। क्या अभी बात करना ठीक रहेगा?`
- Consent EN: `Hello {name}, this is {hr_name} from {company}. May we keep your details on file to contact you about future openings? You can say no or ask us to delete them at any time.`
- Consent HI: `नमस्ते {name}, मैं {company} से {hr_name}। क्या हम भविष्य की नौकरियों के लिए आपसे संपर्क करने हेतु आपकी जानकारी रख सकते हैं? आप कभी भी मना कर सकते हैं या जानकारी हटाने के लिए कह सकते हैं।`

## A — reject categories, cost details, other offers, hiring summary

### Reject categories (list `reject_category`, sample)

| Code | Label | Kind |
|---|---|---|
| `cost` | Cost / salary expectation | non_skill |
| `knowledge` | Knowledge / skills | skill |
| `communication` | Communication / English | skill |
| `typing_voice` | Typing / voice test | skill |
| `attitude` | Attitude / stability | skill |
| `shift_location` | Shift / location / availability | non_skill |
| `notice_timing` | Notice period / timing | non_skill |
| `seat_filled` | Seat filled / better candidate chosen | non_skill |
| `documents` | Documents / background | neutral |
| `no_show` | No-show / walked away | neutral |
| `other` | Other | neutral |

HR can rename, reorder, retire, add (with a kind) and change the kind. Rules use the code: renaming "Cost / salary
expectation" keeps the cost rules working.

Sample reason → category: Spoken English / communication → communication · Typing speed below requirement →
typing_voice · No relevant RCM experience, Required certification missing, Failed assessment / test → knowledge ·
Salary expectation above budget → cost · Notice period too long → notice_timing · Not willing to work US / night
shift → shift_location · Did not attend the round → no_show · Other → other. A new reason defaults to Other.

The reject form (interview, manager override) still requires a reason; its category is shown next to it and stored
on the visit. No-show / walked away are stored as `no_show` automatically.

### Cost details

When the chosen reason's category is `cost`, the reject form also asks (optional): the candidate's expected CTC
(LPA, prefilled from the profile) and our budget / offered CTC (LPA). Same on the manager override and on
"offer declined" (category optional there; budget = offered CTC, prefilled). Gap = expected − budget, in LPA and %
of budget, rounded: asked 4.2 vs budget 3.0 → "+1.2 LPA (+40%)". Missing budget → "asked 4.2 LPA, budget not
recorded". Figures stay only on the visit (HR-only).

### Other offer in hand

Optional: company, offered CTC (LPA), joining date, noted date (default today). Entered in intake's collapsed
"More details" section (never required, never slows intake; skipped when empty) and on the profile. Every record is
kept; the latest (by noted date, then entry time) is shown.

### Hiring summary (`src/lib/rediscovery/summary.ts`, pure)

Input: the candidate's visits (with decision, category, cost figures, offer) and scorecards (stage, position,
criterion scores, interviewer, notes). Output per visit and overall:

- **Status**: HIRED (joined) · SELECTED / OFFERED (selected, not yet joined; "Offered" once an offer is recorded) ·
  NOT HIRED (rejected) · DIDN'T FINISH (no-show, walked away, offer declined) · IN PROGRESS · ON HOLD.
- **Rounds reached**: names of the rounds with a scorecard, in stage order.
- **Averages** (1 decimal): a scorecard's average is the mean of its criterion scores (its overall when it has no
  criterion scores); a round's average is the mean of its scorecards; a visit's average is the mean of its rounds;
  the overall average is the mean of the visit averages.
- Strongest and weakest criterion of the visit (mean per criterion; ties: first in stage order), interviewer notes
  (latest first), last decision date.
- **One line**, e.g. `Not hired — Cost: asked 4.2 vs budget 3.0 LPA (+40%) · reached Manager round · avg 4.1/5`,
  `Didn't finish — Offer declined (Cost: asked 4.5 vs offered 3.8 LPA (+18%))`, `Hired — joined 01 Dec 2026 ·
  reached Ops round · avg 4.0/5`, `In progress — HR screen`, `On hold — Ops round · avg 3.5/5`.
  No scorecards → "no interview scores".
- The overall line is the latest visit's line (visits ordered by day, then registration time); several visits on
  one day are separate visits; each visit names its own position.
- Data removed by retention: the summary works on what remains (a visit without scorecards just says so).

`GET /api/candidates/[id]/summary`: HR, admin, manager; interviewers only for candidates they were called to
interview (same rule as the profile); 404 for other tenants.

## B — tags, suggestions, do not rehire, score change

### Tags (list `rediscovery_tag`, sample)

`high_cost` Good but high cost · `near_miss` Near-miss (silver medal) · `reconsider` Good — reconsider later ·
`do_not_rehire` Do not rehire. Several per candidate; each has a note, who, when and its source (manual / accepted
suggestion). Removing needs a note; history is kept. The four system tags can be renamed but not retired. HR,
managers and admins tag any candidate who has a decided visit.

### Suggestion rules (`suggest.ts`, pure)

Considered: the latest **decided** visit (rejected or offer declined). Its average = the visit average above.

- **Good but high cost**: the decision's category is `cost` AND visit average ≥ `score_threshold`.
- **Near-miss**: (rejected for a `non_skill` category AND (reached the last active interview round OR average ≥
  threshold)) OR the outcome is offer declined.
- Never: candidates tagged Do not rehire, anyone who ever joined, skill-category rejections, candidates without
  scores ("No interview scores, so no suggestion"), a tag the candidate already has.
- Each suggestion carries its reason: `Rejected for Cost: asked 4.2 vs 3.0 LPA · avg 4.1 ≥ 3.5`.
- Threshold is inclusive: 3.5 ≥ 3.5 suggests, 3.49 does not.

Shown as a banner on the profile and on `/dashboard/suggestions` (newest decision first). Accept (adds the tag,
source = suggestion) or Dismiss, each with an optional note. A dismissal is remembered for candidate + tag + that
decision (visit id and decision time) and the suggestion only returns after a **new** decision. Audited.

### Do not rehire

A tag that requires a note. At intake lookup HR sees a red HR-only warning "Do not rehire — reason, by whom, date";
intake is still allowed (HR decides). Never on the consent screen.

### Score change between visits (`trend.ts`, pure)

Uses the last two visits that have scores. Rounds both visits share are compared round by round (mean of those round
averages); if they share none, the visit averages are compared and labelled "different rounds". Output
`2.8 → 3.9, +1.1` with ↑ (≥ +0.1), ↓ (≤ −0.1) or → otherwise.

## C — quick-look search and profile summary

- Header search (HR, admin, manager; not interviewers, not the TV): 2+ letters of a name or 4+ digits of a mobile,
  debounced 200 ms, up to 8 matches of this tenant, typo-tolerant (pg_trgm word similarity ≥ 0.4 or substring),
  best match first, then most recent visit. Index-backed (`<%` with `pg_trgm.word_similarity_threshold`, trigram
  index on mobile). Keyboard: "/" focuses it, ↑ ↓ move, Enter opens the profile, Esc closes. Combobox roles.
- Each row: photo (lazy), name, mobile, city (always, to tell two same-name people apart), last position,
  qualification · certifications · experience, last visit and visit count, the summary line, score change, tags,
  "Due for call-back".
- Profile **Summary** card at the top: who they are (age, city, education, certifications, software, experience,
  languages, other offer in hand), one line per visit (date · position · rounds · outcome · reason · avg), score
  change, tags with notes, call-back, last contacted, joining-risk hints, talent-pool consent, and "data deletes on
  <date>" or "kept (talent-pool consent until <date>)".

## D — contact etiquette, call-backs, consent, keep period

- **Contact log**: Call (`tel:+91…`), WhatsApp (`https://wa.me/91…?text=…`, click-to-chat only) and "Mark contacted"
  record channel, purpose (call-back / bulk push / consent request / other), outcome (no answer / interested / not
  interested / call later / wrong number), note, who, when. Shown on the profile. Audited.
- **Cooling**: contacted fewer than `contact_cooling_days` IST days ago → "Contacted 12 days ago by <name> —
  contact again?" Continue / Cancel. Never blocks. (29 days with 30 → warning; 30 → none.)
- **WhatsApp** only if the latest consent (not withdrawn) ticked WhatsApp updates; otherwise "Call only". Mobile
  becomes +91 for wa.me. Templates rendered with `{name} {company} {position} {hr_name}`; unknown placeholders stay.
- **Do not contact** (the candidate asked): reason + who + when. Hides the person from the pool, bulk lists,
  call-backs and every Call / WhatsApp button; shown on the profile. Only an admin can clear it, with a note.
- **Call-backs**: offered when the decision's category is `notice_timing` or `shift_location`, or the outcome is on
  hold; HR can also set one on any decided candidate. Default date = decision day + notice days (notice 0 or unknown
  → `callback_default_days`); HR edits date + note. `/dashboard/callbacks`: due (date ≤ today), oldest first,
  excluding Do not contact; Open / Call / WhatsApp / Done (with outcome) / Snooze to a date. Dashboard card with the
  count. Audited.
- **Consent after the visit**: HR records talent-pool consent given later (date, channel in person / WhatsApp /
  phone / email, note, optional WhatsApp updates). It is a new `consents` row (the active notice version), so the
  candidate is in the talent pool; their not-hired visits lose their purge dates. **Withdrawal** (one click, date):
  the latest consent gets `withdrawn_at`; out of pools, bulk lists and call-backs; not-hired visits get new purge
  dates counted from the withdrawal date (data and photo periods), so normal retention restarts then.
- **Keep period**: a talent-pool candidate is erasable once `talent_pool_keep_months` have passed since the later of
  their last visit and their last consent (renewal = recording consent again), unless they joined or have a visit in
  progress / on hold / selected. The existing deletion job does it (`planPurge` / `candidateErasable`). Settings shows
  a dry run: "pool candidates expiring in the next 30 days: N" with the list.

## E — pool and bulk hiring

- `/dashboard/pool`: everyone with an active tag (Do not contact hidden unless "show do-not-contact" is on).
  Filters (in the URL): tag, position, certification, software, experience range, expected CTC range, avg score range,
  score change up / down, last visit range, consent (pool / not), due for call-back, contacted in the last N days.
  Sort: avg score, score change, last visit, expected CTC. 25 per page. Excel export of the filtered list (no
  photos), logged in `exports` + audit.
- `/dashboard/bulk`: positions, number needed, max budget (LPA), optional certifications / software, minimum
  experience, night shift / voice process needed. Sources (last visit within `bulk_recency_months`): tagged, near-miss
  (non-skill rejection), on hold, talent pool, offer declined, cost rejections. Always excluded, with counts: Do not
  rehire, Do not contact, joined, past retention without talent-pool consent, in an active visit (in progress or
  selected), more than `bulk_over_budget_percent` over budget. Positions, when chosen, keep people who applied for one of
  them before.
- **Ranking** (`rank.ts`, pure, weights from Settings): each part 0–1 — budget fit (≤ budget 1; over: falls from 1 to 0.5 at
  the over-budget limit, beyond it the person is left out; unknown 0.5), score ((avg − 1) / 4; none 0), skills match (share of asked certifications /
  software / minimum experience met; nothing asked 1), shift fit (night / voice asked and OK 1, unknown 0.5, no 0),
  improvement (0.5 + change / 2, clamped), recency (1 − months since last visit / recency months). Score = weighted
  mean × 100. Every row says why: `Cost reject, asked 3.8 ≤ budget 4.0 · avg 4.2 · CPC · Epic · night OK`. A
  "How this list is ranked" panel shows the weights.
- **Hiring pushes**: save the list with a name and its criteria; per person To call / Called — no answer / Interested /
  Not interested / Booked for interview / Hired; contacting from the push uses the contact log, cooling and templates
  (purpose bulk push). Progress counts. Warns "already in push X". Excel export. Audited.

## F — joining-risk hints, reports, demo, docs

- **Hints** (`risk.ts`, pure) for Selected / Offered candidates not yet joined, each toggleable with its threshold:
  other offer in hand (company + CTC) · notice ≥ `risk_notice_days` · expected above offered by ≥
  `risk_ctc_gap_percent` · joining date more than `risk_joining_days` away · city ≠ office city (optional). Plain words
  with the reason; "No risk hints" when none apply; never a single score; never changes an outcome. On the profile
  Summary card, the drive board's done list (selected) and `/dashboard/joining` (HR / manager / admin). Hint codes are
  saved on the visit when an offer is recorded, for the report below.
- **Reports** (date range, IST, "data as of"): why we didn't hire (by category and by position), cost gap (count,
  average expected vs budget, missing budget), pool size by tag, suggestions accepted vs dismissed, call-backs due /
  done / outcomes, push results (called → interested → booked → hired), joining-risk hints vs outcome (joined vs
  dropped). Real rows only, empty states.
- Demo data (`npm run demo:seed`): cost rejections, near-misses, a returning candidate with a score change, call-backs
  due today, an offer with risk hints and a hiring push, in the demo tenant only.

## Permissions

`rediscovery` (admin, HR, manager): pool, bulk, pushes, suggestions, call-backs, joining soon, quick-look, tags,
contact log, other offers, consent recording. `contactUnblock` (admin): clear Do not contact. Exports keep `export`
(admin, HR). Settings → Rediscovery and Lists keep `settings` (admin).

## Edge cases

- Same name twice: quick-look and pool always show mobile + city.
- Cost rejection without budget: summary and suggestion say "budget not recorded"; ranking still uses the expected CTC.
- Low scorer rejected for cost: no "Good but high cost" (and no near-miss unless they reached the last round).
- Dismiss, then a new decision on a later visit (or the same visit re-decided) → the suggestion can return.
- Do-not-rehire person walks in again: red warning at lookup; HR may register them.
- Consent recorded then withdrawn: purge dates restart from the withdrawal date.
- Candidate erased by retention or a rights request: tags, contact log, call-backs, other offers and push rows go too.
- A second tenant never sees any of it (every query on `tenant_id`; ids of other tenants answer 404).

## Implementation map (final, 2026-11-12)

| Part | Where |
|---|---|
| Rules (pure, unit-tested) | `src/lib/rediscovery/{settings,categories,summary,suggest,trend,contact,rank,risk}.ts`; retention keep period in `src/lib/retention.ts` |
| Data and writes | `src/lib/rediscovery/{settings-db,data,actions,pool,quicklook,callbacks}.ts`; categories / cost figures on decisions in `src/lib/drive.ts`; keep period in `src/lib/purge.ts` |
| Screens | profile Summary card + Contact and call-backs (`dashboard/candidates/[id]`), `dashboard/{pool,bulk,pushes,suggestions,callbacks,joining}`, Settings → Rediscovery and Lists, reject fields on the interview / override / offer forms, intake "More details", header quick-look, drive board hints, Reports → Rediscovery |
| APIs | `api/candidates/[id]/rediscovery` (all per-candidate actions), `api/candidates/[id]/summary`, `api/quicklook`, `api/pushes`, `api/pushes/[id]`, `api/settings/rediscovery`, `api/exports/{pool,bulk,push}` |
| Tests | unit (`src/lib/rediscovery/*.test.ts`), `npm run smoke` (`scripts/smoke-rediscovery.ts`), `e2e/rediscovery.spec.ts`, `scripts/perf-rediscovery.ts` |

Measured on 10,000 sample candidates (dev laptop, PostgreSQL 16): quick-look 34–108 ms, pool 99–229 ms, bulk list 324 ms.
At this size PostgreSQL scans `candidates` faster than it would use the trigram indexes; they take over on larger tables.
