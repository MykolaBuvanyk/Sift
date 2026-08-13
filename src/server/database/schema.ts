import {
  bigint,
  bigserial,
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const importFormat = pgEnum("import_format", ["ndjson", "csv"]);
export const importStatus = pgEnum("import_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const importJobs = pgTable("import_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  contentHash: text("content_hash"),
  sourceObjectPath: text("source_object_path").notNull(),
  format: importFormat("format").notNull(),
  status: importStatus("status").default("pending").notNull(),
  totalBytes: bigint("total_bytes", { mode: "number" }).notNull(),
  processedBytes: bigint("processed_bytes", { mode: "number" }).default(0).notNull(),
  lastLineNumber: bigint("last_line_number", { mode: "number" }).default(0).notNull(),
  importedCount: bigint("imported_count", { mode: "number" }).default(0).notNull(),
  failedCount: bigint("failed_count", { mode: "number" }).default(0).notNull(),
  duplicateCount: bigint("duplicate_count", { mode: "number" }).default(0).notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  leaseToken: uuid("lease_token"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("import_jobs_owner_idempotency_idx").on(table.ownerId, table.idempotencyKey),
  index("import_jobs_worker_idx")
    .on(table.status, table.leaseExpiresAt, table.createdAt)
    .where(sql`${table.uploadedAt} is not null and ${table.status} in ('pending', 'running')`),
  index("import_jobs_owner_status_created_idx").on(table.ownerId, table.status, table.createdAt),
  check("import_jobs_idempotency_key_nonempty_check", sql`length(btrim(${table.idempotencyKey})) > 0`),
  check("import_jobs_source_object_path_nonempty_check", sql`length(btrim(${table.sourceObjectPath})) > 0`),
  check("import_jobs_total_bytes_nonnegative_check", sql`${table.totalBytes} >= 0`),
  check("import_jobs_processed_bytes_range_check", sql`${table.processedBytes} >= 0 and ${table.processedBytes} <= ${table.totalBytes}`),
  check("import_jobs_last_line_number_nonnegative_check", sql`${table.lastLineNumber} >= 0`),
  check("import_jobs_imported_count_nonnegative_check", sql`${table.importedCount} >= 0`),
  check("import_jobs_failed_count_nonnegative_check", sql`${table.failedCount} >= 0`),
  check("import_jobs_duplicate_count_nonnegative_check", sql`${table.duplicateCount} >= 0`),
  check("import_jobs_lease_state_check", sql`
    (${table.status} = 'running' and ${table.claimedAt} is not null and ${table.leaseExpiresAt} is not null and ${table.leaseToken} is not null)
    or
    (${table.status} <> 'running' and ${table.claimedAt} is null and ${table.leaseExpiresAt} is null and ${table.leaseToken} is null)
  `),
  check("import_jobs_lease_window_check", sql`${table.leaseExpiresAt} is null or ${table.leaseExpiresAt} > ${table.claimedAt}`),
  check("import_jobs_terminal_state_check", sql`
    (${table.status} in ('completed', 'failed') and ${table.finishedAt} is not null)
    or
    (${table.status} in ('pending', 'running') and ${table.finishedAt} is null)
  `),
  check("import_jobs_completed_bytes_check", sql`${table.status} <> 'completed' or ${table.processedBytes} = ${table.totalBytes}`),
  check("import_jobs_upload_state_check", sql`
    (${table.uploadedAt} is null and ${table.contentHash} is null)
    or
    (${table.uploadedAt} is not null and ${table.contentHash} ~ '^[0-9a-f]{64}$')
  `),
]);

export const contacts = pgTable("contacts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  tags: text("tags").array().default([]).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("contacts_owner_email_idx").on(table.ownerId, sql`lower(${table.email})`),
  check("contacts_email_normalized_check", sql`${table.email} = lower(btrim(${table.email})) and length(${table.email}) > 0`),
  check("contacts_full_name_nonempty_check", sql`length(btrim(${table.fullName})) > 0`),
]);

export const importRowErrors = pgTable("import_row_errors", {
  jobId: uuid("job_id").notNull().references(() => importJobs.id, { onDelete: "cascade" }),
  lineNumber: bigint("line_number", { mode: "number" }).notNull(),
  errorCode: text("error_code").notNull(),
  message: text("message").notNull(),
  rawExcerpt: text("raw_excerpt").notNull(),
}, (table) => [
  primaryKey({ columns: [table.jobId, table.lineNumber] }),
  check("import_row_errors_line_number_positive_check", sql`${table.lineNumber} > 0`),
  check("import_row_errors_error_code_nonempty_check", sql`length(btrim(${table.errorCode})) > 0`),
  check("import_row_errors_message_nonempty_check", sql`length(btrim(${table.message})) > 0`),
  check("import_row_errors_raw_excerpt_length_check", sql`char_length(${table.rawExcerpt}) <= 500`),
]);
