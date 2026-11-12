ALTER TYPE "public"."option_list" ADD VALUE 'reject_category';--> statement-breakpoint
ALTER TYPE "public"."option_list" ADD VALUE 'rediscovery_tag';--> statement-breakpoint
CREATE TABLE "callbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"application_id" uuid,
	"due_on" date NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"outcome" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_by" text,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "candidate_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"tag_code" text NOT NULL,
	"note" text,
	"source" text NOT NULL,
	"added_by" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" text,
	"remove_note" text
);
--> statement-breakpoint
CREATE TABLE "contact_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"purpose" text NOT NULL,
	"outcome" text,
	"note" text,
	"push_id" uuid,
	"contacted_by" text,
	"contacted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "do_not_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"set_by" text,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	"cleared_by" text,
	"clear_note" text
);
--> statement-breakpoint
CREATE TABLE "hiring_pushes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "other_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"company" text,
	"offered_ctc" integer,
	"joining_date" date,
	"noted_on" date NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "other_offers_ctc_ck" CHECK (coalesce("other_offers"."offered_ctc", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "push_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"push_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"status" text DEFAULT 'to_call' NOT NULL,
	"rank" integer NOT NULL,
	"score" integer NOT NULL,
	"why" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_members_push_candidate_uq" UNIQUE("push_id","candidate_id")
);
--> statement-breakpoint
CREATE TABLE "suggestion_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"tag_code" text NOT NULL,
	"application_id" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"note" text,
	"dismissed_by" text,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"sample" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_settings_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "reject_category" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "cost_expected_ctc" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "cost_budget_ctc" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "risk_hints" text[];--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "option_items" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "option_items" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "reject_reasons" ADD COLUMN "category_code" text;--> statement-breakpoint
ALTER TABLE "callbacks" ADD CONSTRAINT "callbacks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callbacks" ADD CONSTRAINT "callbacks_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callbacks" ADD CONSTRAINT "callbacks_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callbacks" ADD CONSTRAINT "callbacks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callbacks" ADD CONSTRAINT "callbacks_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_tags" ADD CONSTRAINT "candidate_tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_tags" ADD CONSTRAINT "candidate_tags_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_tags" ADD CONSTRAINT "candidate_tags_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_tags" ADD CONSTRAINT "candidate_tags_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_log" ADD CONSTRAINT "contact_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_log" ADD CONSTRAINT "contact_log_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_log" ADD CONSTRAINT "contact_log_push_id_hiring_pushes_id_fk" FOREIGN KEY ("push_id") REFERENCES "public"."hiring_pushes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_log" ADD CONSTRAINT "contact_log_contacted_by_users_id_fk" FOREIGN KEY ("contacted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "do_not_contact" ADD CONSTRAINT "do_not_contact_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "do_not_contact" ADD CONSTRAINT "do_not_contact_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "do_not_contact" ADD CONSTRAINT "do_not_contact_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "do_not_contact" ADD CONSTRAINT "do_not_contact_cleared_by_users_id_fk" FOREIGN KEY ("cleared_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_pushes" ADD CONSTRAINT "hiring_pushes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_pushes" ADD CONSTRAINT "hiring_pushes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_offers" ADD CONSTRAINT "other_offers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_offers" ADD CONSTRAINT "other_offers_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_offers" ADD CONSTRAINT "other_offers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_members" ADD CONSTRAINT "push_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_members" ADD CONSTRAINT "push_members_push_id_hiring_pushes_id_fk" FOREIGN KEY ("push_id") REFERENCES "public"."hiring_pushes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_members" ADD CONSTRAINT "push_members_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_members" ADD CONSTRAINT "push_members_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_dismissals" ADD CONSTRAINT "suggestion_dismissals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_dismissals" ADD CONSTRAINT "suggestion_dismissals_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_dismissals" ADD CONSTRAINT "suggestion_dismissals_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_dismissals" ADD CONSTRAINT "suggestion_dismissals_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "callbacks_tenant_due_idx" ON "callbacks" USING btree ("tenant_id","status","due_on");--> statement-breakpoint
CREATE INDEX "callbacks_candidate_idx" ON "callbacks" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "candidate_tags_tenant_tag_idx" ON "candidate_tags" USING btree ("tenant_id","tag_code");--> statement-breakpoint
CREATE INDEX "candidate_tags_candidate_idx" ON "candidate_tags" USING btree ("candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_tags_one_active_uq" ON "candidate_tags" USING btree ("candidate_id","tag_code") WHERE removed_at is null;--> statement-breakpoint
CREATE INDEX "contact_log_candidate_idx" ON "contact_log" USING btree ("candidate_id","contacted_at");--> statement-breakpoint
CREATE INDEX "contact_log_tenant_idx" ON "contact_log" USING btree ("tenant_id","contacted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "do_not_contact_one_active_uq" ON "do_not_contact" USING btree ("candidate_id") WHERE cleared_at is null;--> statement-breakpoint
CREATE INDEX "do_not_contact_tenant_idx" ON "do_not_contact" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hiring_pushes_tenant_idx" ON "hiring_pushes" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "other_offers_candidate_idx" ON "other_offers" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "push_members_candidate_idx" ON "push_members" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "suggestion_dismissals_candidate_idx" ON "suggestion_dismissals" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "candidates_mobile_trgm_idx" ON "candidates" USING gin ("mobile" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "option_items_tenant_list_code_uq" ON "option_items" USING btree ("tenant_id","list","code") WHERE code is not null;--> statement-breakpoint
-- Backfill (Phase 3.6): every reject reason gets a category (sample reasons by label, any other reason: other) ...
UPDATE "reject_reasons" SET "category_code" = CASE "label"
  WHEN 'Spoken English / communication' THEN 'communication'
  WHEN 'Typing speed below requirement' THEN 'typing_voice'
  WHEN 'No relevant RCM experience' THEN 'knowledge'
  WHEN 'Required certification missing' THEN 'knowledge'
  WHEN 'Failed assessment / test' THEN 'knowledge'
  WHEN 'Salary expectation above budget' THEN 'cost'
  WHEN 'Notice period too long' THEN 'notice_timing'
  WHEN 'Not willing to work US / night shift' THEN 'shift_location'
  WHEN 'Did not attend the round' THEN 'no_show'
  ELSE 'other' END
WHERE "category_code" IS NULL;--> statement-breakpoint
-- ... and so does every rejected visit (its reason's category; unknown reason: other) and every no-show / walk-away.
UPDATE "applications" a SET "reject_category" = coalesce(
  (SELECT r."category_code" FROM "reject_reasons" r WHERE r."tenant_id" = a."tenant_id" AND r."label" = a."reject_reason"), 'other')
WHERE a."outcome" = 'rejected' AND a."reject_category" IS NULL;--> statement-breakpoint
UPDATE "applications" SET "reject_category" = 'no_show' WHERE "outcome" IN ('no_show', 'withdrawn') AND "reject_category" IS NULL;
