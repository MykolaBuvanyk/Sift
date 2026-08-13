import { z } from "zod";

export const importFormatSchema = z.enum(["ndjson", "csv"]);
export const importJobStatusSchema = z.enum(["pending", "running", "completed", "failed"]);

export const createImportRequestSchema = z.object({
  idempotency_key: z.string().trim().min(1).max(200),
  format: importFormatSchema,
  filename: z.string().trim().min(1).max(255),
  declared_size_bytes: z.number().int().positive().max(5_000_000_000),
}).strict();

export const createImportResponseSchema = z.object({
  job_id: z.uuid(),
  status: importJobStatusSchema,
  upload_required: z.boolean(),
  upload_url: z.url().nullable(),
  upload_method: z.literal("PUT").nullable(),
  upload_headers: z.record(z.string(), z.string()),
  upload_url_expires_at: z.iso.datetime().nullable(),
  reservation_expires_at: z.iso.datetime(),
}).strict();

export const finalizeImportResponseSchema = z.object({
  job_id: z.uuid(),
  status: importJobStatusSchema,
  content_hash: z.string().regex(/^[0-9a-f]{64}$/),
  total_bytes: z.number().int().positive(),
  uploaded_at: z.iso.datetime(),
}).strict();

export const importJobSchema = z.object({
  id: z.uuid(),
  format: importFormatSchema,
  status: importJobStatusSchema,
  total_bytes: z.number().int().nonnegative(),
  processed_bytes: z.number().int().nonnegative(),
  last_line_number: z.number().int().nonnegative(),
  imported_count: z.number().int().nonnegative(),
  failed_count: z.number().int().nonnegative(),
  duplicate_count: z.number().int().nonnegative(),
  progress_percent: z.number().min(0).max(100),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  finished_at: z.iso.datetime().nullable(),
}).strict();

export const importRowErrorSchema = z.object({
  line_number: z.number().int().positive(),
  error_code: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(500),
  raw_excerpt: z.string().max(500),
}).strict();

export const retryImportResponseSchema = z.object({
  job: importJobSchema,
  retried: z.boolean(),
}).strict();

export const apiErrorSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*$/),
  message: z.string().min(1),
  details: z.unknown().optional(),
  traceId: z.string().min(1).max(127),
}).strict();

export const contactSchema = z.object({
  email: z.email(),
  full_name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(50).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
}).strict();

export type Contact = z.infer<typeof contactSchema>;
export type ImportFormat = z.infer<typeof importFormatSchema>;
export type ImportJobStatus = z.infer<typeof importJobStatusSchema>;
export type CreateImportRequest = z.infer<typeof createImportRequestSchema>;
export type CreateImportResponse = z.infer<typeof createImportResponseSchema>;
export type FinalizeImportResponse = z.infer<typeof finalizeImportResponseSchema>;
export type ImportJob = z.infer<typeof importJobSchema>;
export type ImportRowError = z.infer<typeof importRowErrorSchema>;
export type RetryImportResponse = z.infer<typeof retryImportResponseSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
