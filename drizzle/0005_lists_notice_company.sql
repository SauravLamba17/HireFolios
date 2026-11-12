CREATE TYPE "public"."notice_status" AS ENUM('draft', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."option_list" AS ENUM('certification', 'coding_specialty', 'ehr_software', 'education', 'notice_period', 'source', 'language');--> statement-breakpoint
CREATE TABLE "option_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"list" "option_list" NOT NULL,
	"label" text NOT NULL,
	"days" integer,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer NOT NULL,
	"sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" text NOT NULL,
	"status" "notice_status" NOT NULL,
	"effective_date" date,
	"texts" jsonb NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"published_at" timestamp with time zone,
	"published_by" text,
	CONSTRAINT "privacy_notices_tenant_version_uq" UNIQUE("tenant_id","version")
);
--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "notice_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "short_name" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "office_address" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "time_zone" text DEFAULT 'Asia/Kolkata' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "logo_type" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "logo_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "profile_sample" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "option_items" ADD CONSTRAINT "option_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_notices" ADD CONSTRAINT "privacy_notices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_notices" ADD CONSTRAINT "privacy_notices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_notices" ADD CONSTRAINT "privacy_notices_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "option_items_tenant_list_label_uq" ON "option_items" USING btree ("tenant_id","list","label");--> statement-breakpoint
CREATE INDEX "option_items_tenant_list_idx" ON "option_items" USING btree ("tenant_id","list","position");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_notices_one_active_uq" ON "privacy_notices" USING btree ("tenant_id") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_notices_one_draft_uq" ON "privacy_notices" USING btree ("tenant_id") WHERE status = 'draft';--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_notice_id_privacy_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."privacy_notices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Tokens have always been printed as A-001 (token_prefix was not used); keep that when the prefix starts to be used.
UPDATE "tenants" SET "token_prefix" = 'A' WHERE "slug" = 'simplen' AND "token_prefix" = 'SB';
