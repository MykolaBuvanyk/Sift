ALTER TABLE "import_row_errors" DROP CONSTRAINT "import_row_errors_error_code_nonempty_check";--> statement-breakpoint
ALTER TABLE "import_row_errors" DROP CONSTRAINT "import_row_errors_message_nonempty_check";--> statement-breakpoint
ALTER TABLE "import_row_errors" DROP CONSTRAINT "import_row_errors_raw_excerpt_length_check";--> statement-breakpoint
ALTER TABLE "import_row_errors" ADD CONSTRAINT "import_row_errors_error_code_length_check" CHECK (length(btrim("import_row_errors"."error_code")) between 1 and 100);--> statement-breakpoint
ALTER TABLE "import_row_errors" ADD CONSTRAINT "import_row_errors_message_length_check" CHECK (char_length("import_row_errors"."message") between 1 and 500);--> statement-breakpoint
ALTER TABLE "import_row_errors" ADD CONSTRAINT "import_row_errors_raw_excerpt_length_check" CHECK (char_length("import_row_errors"."raw_excerpt") <= 500 and octet_length("import_row_errors"."raw_excerpt") <= 500);