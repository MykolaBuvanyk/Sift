import {
  bigint,
  bigserial,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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
  contentHash: text("content_hash").notNull(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("import_jobs_owner_idempotency_idx").on(table.ownerId, table.idempotencyKey),
  index("import_jobs_worker_idx").on(table.status, table.leaseExpiresAt, table.createdAt),
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
  uniqueIndex("contacts_owner_email_idx").on(table.ownerId, table.email),
]);

export const importRowErrors = pgTable("import_row_errors", {
  jobId: uuid("job_id").notNull().references(() => importJobs.id, { onDelete: "cascade" }),
  lineNumber: bigint("line_number", { mode: "number" }).notNull(),
  errorCode: text("error_code").notNull(),
  message: text("message").notNull(),
  rawExcerpt: text("raw_excerpt").notNull(),
}, (table) => [
  primaryKey({ columns: [table.jobId, table.lineNumber] }),
]);
