DROP INDEX "contacts_owner_email_idx";--> statement-breakpoint
DROP INDEX "import_jobs_worker_idx";--> statement-breakpoint
ALTER TABLE "import_jobs" ALTER COLUMN "content_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "uploaded_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "import_jobs_owner_status_created_idx" ON "import_jobs" USING btree ("owner_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_owner_email_idx" ON "contacts" USING btree ("owner_id",lower("email"));--> statement-breakpoint
CREATE INDEX "import_jobs_worker_idx" ON "import_jobs" USING btree ("status","lease_expires_at","created_at") WHERE "import_jobs"."uploaded_at" is not null and "import_jobs"."status" in ('pending', 'running');--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_email_normalized_check" CHECK ("contacts"."email" = lower(btrim("contacts"."email")) and length("contacts"."email") > 0);--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_full_name_nonempty_check" CHECK (length(btrim("contacts"."full_name")) > 0);--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_idempotency_key_nonempty_check" CHECK (length(btrim("import_jobs"."idempotency_key")) > 0);--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_source_object_path_nonempty_check" CHECK (length(btrim("import_jobs"."source_object_path")) > 0);--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_total_bytes_nonnegative_check" CHECK ("import_jobs"."total_bytes" >= 0);--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_processed_bytes_range_check" CHECK ("import_jobs"."processed_bytes" >= 0 and "import_jobs"."processed_bytes" <= "import_jobs"."total_bytes");--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_last_line_number_nonnegative_check" CHECK ("import_jobs"."last_line_number" >= 0);--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_imported_count_nonnegative_check" CHECK ("import_jobs"."imported_count" >= 0);--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_failed_count_nonnegative_check" CHECK ("import_jobs"."failed_count" >= 0);--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_duplicate_count_nonnegative_check" CHECK ("import_jobs"."duplicate_count" >= 0);--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_lease_state_check" CHECK (
    ("import_jobs"."status" = 'running' and "import_jobs"."claimed_at" is not null and "import_jobs"."lease_expires_at" is not null and "import_jobs"."lease_token" is not null)
    or
    ("import_jobs"."status" <> 'running' and "import_jobs"."claimed_at" is null and "import_jobs"."lease_expires_at" is null and "import_jobs"."lease_token" is null)
  );--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_lease_window_check" CHECK ("import_jobs"."lease_expires_at" is null or "import_jobs"."lease_expires_at" > "import_jobs"."claimed_at");--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_terminal_state_check" CHECK (
    ("import_jobs"."status" in ('completed', 'failed') and "import_jobs"."finished_at" is not null)
    or
    ("import_jobs"."status" in ('pending', 'running') and "import_jobs"."finished_at" is null)
  );--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_completed_bytes_check" CHECK ("import_jobs"."status" <> 'completed' or "import_jobs"."processed_bytes" = "import_jobs"."total_bytes");--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_upload_state_check" CHECK (
    ("import_jobs"."uploaded_at" is null and "import_jobs"."content_hash" is null)
    or
    ("import_jobs"."uploaded_at" is not null and "import_jobs"."content_hash" ~ '^[0-9a-f]{64}$')
  );--> statement-breakpoint
ALTER TABLE "import_row_errors" ADD CONSTRAINT "import_row_errors_line_number_positive_check" CHECK ("import_row_errors"."line_number" > 0);--> statement-breakpoint
ALTER TABLE "import_row_errors" ADD CONSTRAINT "import_row_errors_error_code_nonempty_check" CHECK (length(btrim("import_row_errors"."error_code")) > 0);--> statement-breakpoint
ALTER TABLE "import_row_errors" ADD CONSTRAINT "import_row_errors_message_nonempty_check" CHECK (length(btrim("import_row_errors"."message")) > 0);--> statement-breakpoint
ALTER TABLE "import_row_errors" ADD CONSTRAINT "import_row_errors_raw_excerpt_length_check" CHECK (char_length("import_row_errors"."raw_excerpt") <= 500);