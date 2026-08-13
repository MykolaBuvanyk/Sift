ALTER TABLE "import_jobs" ADD COLUMN "original_name" text;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "reservation_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "cleanup_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "cleanup_token" uuid;--> statement-breakpoint
CREATE INDEX "import_jobs_expired_reservation_idx" ON "import_jobs" USING btree ("reservation_expires_at") WHERE "import_jobs"."uploaded_at" is null;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_original_name_nonempty_check" CHECK ("import_jobs"."original_name" is null or length(btrim("import_jobs"."original_name")) > 0);--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_cleanup_claim_check" CHECK (
    ("import_jobs"."cleanup_claimed_at" is null and "import_jobs"."cleanup_token" is null)
    or
    ("import_jobs"."cleanup_claimed_at" is not null and "import_jobs"."cleanup_token" is not null and "import_jobs"."uploaded_at" is null)
  );