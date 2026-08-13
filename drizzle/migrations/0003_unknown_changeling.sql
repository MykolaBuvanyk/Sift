CREATE TABLE "import_job_seen_contacts" (
	"job_id" uuid NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_job_seen_contacts_job_id_email_pk" PRIMARY KEY("job_id","email"),
	CONSTRAINT "import_job_seen_contacts_email_normalized_check" CHECK ("import_job_seen_contacts"."email" = lower(btrim("import_job_seen_contacts"."email")) and length("import_job_seen_contacts"."email") > 0)
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "failure_message" text;--> statement-breakpoint
ALTER TABLE "import_job_seen_contacts" ADD CONSTRAINT "import_job_seen_contacts_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_failure_metadata_check" CHECK (
    ("import_jobs"."failure_code" is null and "import_jobs"."failure_message" is null)
    or
    ("import_jobs"."status" = 'failed' and length(btrim("import_jobs"."failure_code")) > 0 and length(btrim("import_jobs"."failure_message")) > 0)
  );