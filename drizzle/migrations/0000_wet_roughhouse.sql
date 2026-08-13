CREATE TYPE "public"."import_format" AS ENUM('ndjson', 'csv');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"source_object_path" text NOT NULL,
	"format" "import_format" NOT NULL,
	"status" "import_status" DEFAULT 'pending' NOT NULL,
	"total_bytes" bigint NOT NULL,
	"processed_bytes" bigint DEFAULT 0 NOT NULL,
	"last_line_number" bigint DEFAULT 0 NOT NULL,
	"imported_count" bigint DEFAULT 0 NOT NULL,
	"failed_count" bigint DEFAULT 0 NOT NULL,
	"duplicate_count" bigint DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_row_errors" (
	"job_id" uuid NOT NULL,
	"line_number" bigint NOT NULL,
	"error_code" text NOT NULL,
	"message" text NOT NULL,
	"raw_excerpt" text NOT NULL,
	CONSTRAINT "import_row_errors_job_id_line_number_pk" PRIMARY KEY("job_id","line_number")
);
--> statement-breakpoint
ALTER TABLE "import_row_errors" ADD CONSTRAINT "import_row_errors_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_owner_email_idx" ON "contacts" USING btree ("owner_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "import_jobs_owner_idempotency_idx" ON "import_jobs" USING btree ("owner_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "import_jobs_worker_idx" ON "import_jobs" USING btree ("status","lease_expires_at","created_at");