CREATE TYPE "public"."interview_decision" AS ENUM('pass', 'hold', 'reject');--> statement-breakpoint
CREATE TYPE "public"."panel_status" AS ENUM('available', 'busy', 'away', 'closed');--> statement-breakpoint
ALTER TYPE "public"."queue_event_type" ADD VALUE 'returned';--> statement-breakpoint
ALTER TYPE "public"."staff_role" ADD VALUE 'display';--> statement-breakpoint
CREATE TABLE "reject_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reject_reasons_tenant_label_uq" UNIQUE("tenant_id","label")
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "panel_id" uuid;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "purge_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "photo_purge_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "closed_by" text;--> statement-breakpoint
ALTER TABLE "panels" ADD COLUMN "drive_id" uuid;--> statement-breakpoint
ALTER TABLE "panels" ADD COLUMN "interviewer_id" text;--> statement-breakpoint
ALTER TABLE "panels" ADD COLUMN "status" "panel_status" DEFAULT 'available' NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_events" ADD COLUMN "interviewer_id" text;--> statement-breakpoint
ALTER TABLE "queue_events" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "scorecards" ADD COLUMN "decision" "interview_decision";--> statement-breakpoint
ALTER TABLE "scorecards" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "scorecards" ADD COLUMN "panel_id" uuid;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "is_interview" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "criteria" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "avg_interview_minutes" integer;--> statement-breakpoint
ALTER TABLE "reject_reasons" ADD CONSTRAINT "reject_reasons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_panel_id_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."panels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drives" ADD CONSTRAINT "drives_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panels" ADD CONSTRAINT "panels_drive_id_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."drives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panels" ADD CONSTRAINT "panels_interviewer_id_users_id_fk" FOREIGN KEY ("interviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_events" ADD CONSTRAINT "queue_events_interviewer_id_users_id_fk" FOREIGN KEY ("interviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_panel_id_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."panels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_tenant_drive_idx" ON "applications" USING btree ("tenant_id","drive_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_panel_uq" ON "applications" USING btree ("panel_id") WHERE "applications"."panel_id" is not null;--> statement-breakpoint
ALTER TABLE "drives" ADD CONSTRAINT "drives_tenant_location_day_uq" UNIQUE("tenant_id","location_id","drive_date");--> statement-breakpoint
-- Backfill (hand-written): every stage so far came from the sample seed. Mark the sample interview rounds
-- and give them the sample scorecard criteria; admins confirm or change them in Settings.
UPDATE "stages" SET "sample" = true;--> statement-breakpoint
UPDATE "stages" SET "is_interview" = true,
  "criteria" = '[{"label":"Communication","required":false},{"label":"Process knowledge","required":false},{"label":"Typing / voice","required":false},{"label":"Attitude & stability","required":false}]'::jsonb
  WHERE "name" IN ('HR screen', 'Typing/voice test', 'Ops round', 'Manager round');
