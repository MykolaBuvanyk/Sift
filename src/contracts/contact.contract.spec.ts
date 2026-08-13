import { describe, expect, it } from "vitest";

import {
  apiErrorSchema,
  contactSchema,
  createImportRequestSchema,
  createImportResponseSchema,
  finalizeImportResponseSchema,
  importJobSchema,
  retryImportResponseSchema,
} from "./index.js";

describe("contactSchema", () => {
  it("accepts a valid contact and rejects an invalid email", () => {
    expect(contactSchema.safeParse({
      email: "person@example.com",
      full_name: "Test Person",
      tags: ["customer"],
    }).success).toBe(true);

    expect(contactSchema.safeParse({
      email: "invalid",
      full_name: "Test Person",
      tags: [],
    }).success).toBe(false);
  });
});

describe("import API contracts", () => {
  it("rejects ownership fields in create-import metadata", () => {
    expect(createImportRequestSchema.safeParse({
      idempotency_key: "upload-1",
      format: "ndjson",
      filename: "contacts.ndjson",
      declared_size_bytes: 128,
      ownerId: "00000000-0000-4000-8000-000000000099",
    }).success).toBe(false);
  });

  it("accepts a bounded progress response", () => {
    expect(importJobSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000001",
      format: "csv",
      status: "running",
      total_bytes: 100,
      processed_bytes: 50,
      last_line_number: 4,
      imported_count: 3,
      failed_count: 1,
      duplicate_count: 0,
      progress_percent: 50,
      created_at: "2026-08-13T09:00:00.000Z",
      updated_at: "2026-08-13T09:01:00.000Z",
      finished_at: null,
    }).success).toBe(true);
  });

  it("accepts the retry response contract", () => {
    expect(retryImportResponseSchema.safeParse({
      retried: true,
      job: {
        id: "00000000-0000-4000-8000-000000000001",
        format: "ndjson",
        status: "pending",
        total_bytes: 100,
        processed_bytes: 50,
        last_line_number: 4,
        imported_count: 3,
        failed_count: 1,
        duplicate_count: 0,
        progress_percent: 50,
        created_at: "2026-08-13T09:00:00.000Z",
        updated_at: "2026-08-13T09:01:00.000Z",
        finished_at: null,
      },
    }).success).toBe(true);
  });

  it("accepts the stable API error shape", () => {
    expect(apiErrorSchema.safeParse({
      code: "AUTH.UNAUTHORIZED",
      message: "A valid Bearer token is required.",
      traceId: "req_123",
    }).success).toBe(true);
  });

  it("accepts create and finalize upload contracts", () => {
    expect(createImportResponseSchema.safeParse({
      job_id: "00000000-0000-4000-8000-000000000001",
      status: "pending",
      upload_required: true,
      upload_url: "http://localhost:9000/upload",
      upload_method: "PUT",
      upload_headers: {
        "Content-Type": "application/x-ndjson",
        "If-None-Match": "*",
      },
      upload_url_expires_at: "2026-08-13T10:05:00.000Z",
      reservation_expires_at: "2026-08-13T11:00:00.000Z",
    }).success).toBe(true);

    expect(finalizeImportResponseSchema.safeParse({
      job_id: "00000000-0000-4000-8000-000000000001",
      status: "pending",
      content_hash: "a".repeat(64),
      total_bytes: 128,
      uploaded_at: "2026-08-13T10:01:00.000Z",
    }).success).toBe(true);
  });
});
