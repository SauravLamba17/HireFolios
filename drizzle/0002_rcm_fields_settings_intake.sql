CREATE TYPE "public"."job_status" AS ENUM('open', 'paused', 'closed');--> statement-breakpoint
ALTER TYPE "public"."candidate_file_kind" ADD VALUE 'cv_upload';--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "hr_notes" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "languages" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "skills" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "certifications" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "coding_specialties" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "ehr_software" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "night_shift_ok" boolean;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "voice_process" boolean;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "typing_wpm" integer;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "talent_pool" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "whatsapp" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "status" "job_status" DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "openings" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "min_experience_years" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "max_experience_years" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "required_certifications" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "candidates_search_fts_idx" ON "candidates" USING gin (to_tsvector('simple', "search_text"));--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_typing_wpm_ck" CHECK ("candidates"."typing_wpm" is null or "candidates"."typing_wpm" between 1 and 250);--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_numbers_ck" CHECK (coalesce("jobs"."openings", 0) >= 0 and coalesce("jobs"."min_experience_years", 0) >= 0 and coalesce("jobs"."max_experience_years", 0) >= 0);--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_experience_range_ck" CHECK ("jobs"."min_experience_years" is null or "jobs"."max_experience_years" is null or "jobs"."min_experience_years" <= "jobs"."max_experience_years");--> statement-breakpoint
-- Backfill (hand-written): status follows the old active flag; every job so far came from the sample seed.
UPDATE "jobs" SET "status" = CASE WHEN "active" THEN 'open'::"job_status" ELSE 'closed'::"job_status" END, "sample" = true;
