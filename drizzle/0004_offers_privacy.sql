CREATE TYPE "public"."offer_status" AS ENUM('offered', 'accepted', 'declined');--> statement-breakpoint
ALTER TYPE "public"."dsr_kind" ADD VALUE 'grievance';--> statement-breakpoint
ALTER TYPE "public"."application_outcome" ADD VALUE 'offer_declined';--> statement-breakpoint
ALTER TYPE "public"."application_outcome" ADD VALUE 'joined';--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "offer_status" "offer_status";--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "offered_ctc" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "joining_date" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "joined_on" date;--> statement-breakpoint
ALTER TABLE "dsr_requests" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dsr_requests" ADD COLUMN "requester_name" text;--> statement-breakpoint
ALTER TABLE "dsr_requests" ADD COLUMN "requester_contact" text;--> statement-breakpoint
ALTER TABLE "dsr_requests" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "dsr_requests" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "dsr_requests" ADD CONSTRAINT "dsr_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;