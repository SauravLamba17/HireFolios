// Every business table carries tenant_id. Queries must always filter on it server-side.
// Money: whole rupees per year (integer). Calendar dates: IST, stored as `date`.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id);

export const roleEnum = pgEnum("staff_role", ["admin", "hr", "interviewer", "manager"]);
export const outcomeEnum = pgEnum("application_outcome", [
  "in_progress",
  "selected",
  "rejected",
  "on_hold",
  "withdrawn",
  "no_show",
]);
// photo: live photo. cv_page: CV page photographed on the tablet. cv_upload: CV file (PDF/image) uploaded as is.
export const fileKindEnum = pgEnum("candidate_file_kind", ["photo", "cv_page", "cv_upload"]);
export const jobStatusEnum = pgEnum("job_status", ["open", "paused", "closed"]);
export const queueEventEnum = pgEnum("queue_event_type", [
  "queued",
  "called",
  "started",
  "completed",
  "skipped",
]);
export const recommendationEnum = pgEnum("scorecard_recommendation", [
  "strong_yes",
  "yes",
  "no",
  "strong_no",
]);
export const dsrKindEnum = pgEnum("dsr_kind", ["access", "correction", "erasure", "withdraw_consent"]);
export const dsrStatusEnum = pgEnum("dsr_status", ["open", "in_progress", "completed", "rejected"]);
export const exportStatusEnum = pgEnum("export_status", ["queued", "running", "done", "failed"]);

export const tenants = pgTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  tokenPrefix: text("token_prefix").notNull(),
  photoRetentionDays: integer("photo_retention_days").notNull().default(180),
  dataRetentionDays: integer("data_retention_days").notNull().default(365),
  cooldownDays: integer("cooldown_days").notNull().default(90),
  createdAt: createdAt(),
});

// ---- Auth (Better Auth). Keys must match Better Auth field names. ----

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    role: roleEnum("role").notNull(),
    tenantId: tenantId(),
    active: boolean("active").notNull().default(true),
    // Set when an admin creates the account or resets its password; cleared when the user changes it.
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("users_tenant_idx").on(t.tenantId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

// ---- Setup ----

export const locations = pgTable(
  "locations",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    address: text("address"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique("locations_tenant_name_uq").on(t.tenantId, t.name)],
);

export const devices = pgTable(
  "devices",
  {
    id: id(),
    tenantId: tenantId(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    lastSeenAt: ts("last_seen_at"),
    createdAt: createdAt(),
  },
  (t) => [unique("devices_tenant_name_uq").on(t.tenantId, t.name)],
);

export const stages = pgTable(
  "stages",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique("stages_tenant_name_uq").on(t.tenantId, t.name)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    tenantId: tenantId(),
    title: text("title").notNull(),
    status: jobStatusEnum("status").notNull().default("open"), // only "open" jobs are offered at intake
    active: boolean("active").notNull().default(true), // legacy, kept equal to status = 'open'
    openings: integer("openings"),
    minExperienceYears: integer("min_experience_years"),
    maxExperienceYears: integer("max_experience_years"),
    requiredCertifications: text("required_certifications").array().notNull().default(sql`'{}'::text[]`),
    sample: boolean("sample").notNull().default(false), // added by the seed, not yet confirmed by an admin
    createdAt: createdAt(),
  },
  (t) => [
    unique("jobs_tenant_title_uq").on(t.tenantId, t.title),
    check("jobs_numbers_ck", sql`coalesce(${t.openings}, 0) >= 0 and coalesce(${t.minExperienceYears}, 0) >= 0 and coalesce(${t.maxExperienceYears}, 0) >= 0`),
    check("jobs_experience_range_ck", sql`${t.minExperienceYears} is null or ${t.maxExperienceYears} is null or ${t.minExperienceYears} <= ${t.maxExperienceYears}`),
  ],
);

export const drives = pgTable(
  "drives",
  {
    id: id(),
    tenantId: tenantId(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    name: text("name").notNull(),
    driveDate: date("drive_date", { mode: "string" }).notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("drives_tenant_date_idx").on(t.tenantId, t.driveDate)],
);

export const panels = pgTable(
  "panels",
  {
    id: id(),
    tenantId: tenantId(),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id),
    locationId: uuid("location_id").references(() => locations.id),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique("panels_tenant_name_uq").on(t.tenantId, t.name)],
);

// ---- Candidates (no Aadhaar collected at intake) ----

export const candidates = pgTable(
  "candidates",
  {
    id: id(),
    tenantId: tenantId(),
    fullName: text("full_name").notNull(),
    mobile: text("mobile").notNull(),
    email: text("email"),
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    city: text("city"),
    qualification: text("qualification"),
    experienceMonths: integer("experience_months"),
    currentCtc: integer("current_ctc"), // whole rupees per year
    expectedCtc: integer("expected_ctc"), // whole rupees per year
    noticeDays: integer("notice_days"),
    languages: text("languages").array().notNull().default(sql`'{}'::text[]`),
    skills: text("skills"),
    // RCM (US healthcare revenue cycle) profile. Values come from src/lib/options.ts.
    certifications: text("certifications").array().notNull().default(sql`'{}'::text[]`),
    codingSpecialties: text("coding_specialties").array().notNull().default(sql`'{}'::text[]`),
    ehrSoftware: text("ehr_software").array().notNull().default(sql`'{}'::text[]`),
    nightShiftOk: boolean("night_shift_ok"),
    voiceProcess: boolean("voice_process"),
    typingWpm: integer("typing_wpm"), // entered by HR for now
    // Written by the app on every save (src/lib/candidate-search.ts); feeds full-text search.
    searchText: text("search_text").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("candidates_tenant_mobile_uq").on(t.tenantId, t.mobile),
    index("candidates_full_name_trgm_idx").using("gin", t.fullName.op("gin_trgm_ops")),
    index("candidates_search_fts_idx").using("gin", sql`to_tsvector('simple', ${t.searchText})`),
    check("candidates_typing_wpm_ck", sql`${t.typingWpm} is null or ${t.typingWpm} between 1 and 250`),
    check("candidates_mobile_ck", sql`${t.mobile} ~ '^[6-9][0-9]{9}$'`),
    check(
      "candidates_money_ck",
      sql`coalesce(${t.currentCtc}, 0) >= 0 and coalesce(${t.expectedCtc}, 0) >= 0`,
    ),
  ],
);

export const applications = pgTable(
  "applications",
  {
    id: id(),
    tenantId: tenantId(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    driveId: uuid("drive_id").references(() => drives.id),
    token: text("token").notNull(),
    tokenDate: date("token_date", { mode: "string" }).notNull(), // IST calendar day
    currentStageId: uuid("current_stage_id")
      .notNull()
      .references(() => stages.id),
    outcome: outcomeEnum("outcome").notNull().default("in_progress"),
    rejectReason: text("reject_reason"),
    clientRequestId: uuid("client_request_id").notNull(), // idempotency key from the tablet
    source: text("source"), // how the candidate heard about the opening (src/lib/options.ts)
    hrNotes: text("hr_notes"),
    createdBy: text("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("applications_tenant_client_request_uq").on(t.tenantId, t.clientRequestId),
    unique("applications_tenant_day_token_uq").on(t.tenantId, t.tokenDate, t.token),
    index("applications_candidate_idx").on(t.candidateId),
    check(
      "applications_reject_reason_ck",
      sql`${t.outcome} <> 'rejected' or ${t.rejectReason} is not null`,
    ),
  ],
);

export const candidateFiles = pgTable(
  "candidate_files",
  {
    id: id(),
    tenantId: tenantId(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id").references(() => applications.id),
    kind: fileKindEnum("kind").notNull(),
    storageKey: text("storage_key").notNull().unique(), // path under /data, never public
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    pageNo: integer("page_no"),
    sha256: text("sha256"),
    createdAt: createdAt(),
    deletedAt: ts("deleted_at"), // set when purged by retention
  },
  (t) => [index("candidate_files_candidate_idx").on(t.candidateId)],
);

export const queueEvents = pgTable(
  "queue_events",
  {
    id: id(),
    tenantId: tenantId(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id),
    panelId: uuid("panel_id").references(() => panels.id),
    event: queueEventEnum("event").notNull(),
    actorUserId: text("actor_user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("queue_events_application_idx").on(t.applicationId),
    index("queue_events_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);

export const scorecards = pgTable(
  "scorecards",
  {
    id: id(),
    tenantId: tenantId(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id),
    interviewerId: text("interviewer_id")
      .notNull()
      .references(() => users.id),
    scores: jsonb("scores").$type<Record<string, number>>().notNull().default({}),
    overall: integer("overall"),
    recommendation: recommendationEnum("recommendation"),
    comments: text("comments"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("scorecards_application_stage_interviewer_uq").on(
      t.applicationId,
      t.stageId,
      t.interviewerId,
    ),
    check("scorecards_overall_ck", sql`${t.overall} between 1 and 5`),
  ],
);

// Per-tenant, per-IST-day token counter (atomic upsert hands out the next token).
export const dailyCounters = pgTable(
  "daily_counters",
  {
    tenantId: tenantId(),
    counterDate: date("counter_date", { mode: "string" }).notNull(),
    lastValue: integer("last_value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.counterDate] })],
);

export const consents = pgTable(
  "consents",
  {
    id: id(),
    tenantId: tenantId(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id").references(() => applications.id),
    noticeVersion: text("notice_version").notNull(),
    language: text("language").notNull().default("en"), // language the notice was shown in
    // Purposes. Assessing this application is the required one; these two are optional extras.
    talentPool: boolean("talent_pool").notNull().default(false),
    whatsapp: boolean("whatsapp").notNull().default(false),
    acceptedAt: ts("accepted_at").notNull().defaultNow(),
    deviceId: uuid("device_id").references(() => devices.id),
    recordedBy: text("recorded_by").references(() => users.id),
    withdrawnAt: ts("withdrawn_at"),
  },
  (t) => [index("consents_candidate_idx").on(t.candidateId)],
);

// Data subject requests (DPDP: access, correction, erasure, consent withdrawal).
export const dsrRequests = pgTable(
  "dsr_requests",
  {
    id: id(),
    tenantId: tenantId(),
    candidateId: uuid("candidate_id").references(() => candidates.id, { onDelete: "set null" }),
    kind: dsrKindEnum("kind").notNull(),
    status: dsrStatusEnum("status").notNull().default("open"),
    requestedAt: ts("requested_at").notNull().defaultNow(),
    resolvedAt: ts("resolved_at"),
    handledBy: text("handled_by").references(() => users.id),
    notes: text("notes"),
  },
  (t) => [index("dsr_requests_tenant_status_idx").on(t.tenantId, t.status)],
);

// Ids only. Never names, mobiles, emails or other personal data.
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: tenantId(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    meta: jsonb("meta").$type<Record<string, string | number | boolean | null>>(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

export const dataExports = pgTable(
  "exports",
  {
    id: id(),
    tenantId: tenantId(),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>(),
    status: exportStatusEnum("status").notNull().default("queued"),
    storageKey: text("storage_key"),
    rowCount: integer("row_count"),
    createdAt: createdAt(),
    completedAt: ts("completed_at"),
    expiresAt: ts("expires_at"),
  },
  (t) => [index("exports_tenant_created_idx").on(t.tenantId, t.createdAt)],
);
