ALTER TABLE "import_jobs" DROP CONSTRAINT "import_jobs_failure_metadata_check";--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_counter_reconciliation_check" CHECK ("import_jobs"."last_line_number" = "import_jobs"."imported_count" + "import_jobs"."failed_count" + "import_jobs"."duplicate_count");--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_failure_metadata_check" CHECK (
    ("import_jobs"."failure_code" is null and "import_jobs"."failure_message" is null)
    or
    ("import_jobs"."status" = 'failed'
      and length(btrim("import_jobs"."failure_code")) between 1 and 100
      and char_length("import_jobs"."failure_message") between 1 and 500)
  );