import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { Environment } from "../../config/environment.js";
import { StorageError } from "../../storage/storage.error.js";
import type { StorageService } from "../../storage/storage.service.js";
import {
  ImportMetadataConflictError,
  ImportNotFoundError,
  ImportRetryNotAllowedError,
  ImportUploadMetadataMismatchError,
  ImportUploadMissingError,
} from "./import.errors.js";
import type { ImportRepository } from "./import.repository.js";
import { ImportService } from "./import.service.js";
import type { ImportReservation } from "./import.types.js";

const ownerId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000010";
const key = `owners/${ownerId}/imports/object`;
const file = Buffer.from('{"email":"a@example.com"}\n');

const environment = {
  IMPORT_MAX_BYTES: 1_000_000,
  IMPORT_RESERVATION_TTL_SECONDS: 3_600,
  IMPORT_FINALIZE_TIMEOUT_MS: 10_000,
  S3_PRESIGN_TTL_SECONDS: 300,
} as Environment;

function reservation(overrides: Partial<ImportReservation> = {}): ImportReservation {
  return {
    id: jobId,
    ownerId,
    idempotencyKey: "upload-1",
    originalName: "contacts.ndjson",
    sourceObjectPath: key,
    format: "ndjson",
    status: "pending",
    totalBytes: file.byteLength,
    processedBytes: 0,
    lastLineNumber: 0,
    importedCount: 0,
    failedCount: 0,
    duplicateCount: 0,
    failureCode: null,
    failureMessage: null,
    contentHash: null,
    uploadedAt: null,
    reservationExpiresAt: new Date(Date.now() + 60_000),
    cleanupToken: null,
    claimedAt: null,
    leaseExpiresAt: null,
    leaseToken: null,
    createdAt: new Date("2026-08-13T09:00:00.000Z"),
    updatedAt: new Date("2026-08-13T09:01:00.000Z"),
    finishedAt: null,
    ...overrides,
  };
}

function createMocks(existing = reservation()) {
  const repository = {
    createOrGet: vi.fn().mockResolvedValue({ reservation: existing, created: true }),
    findOwnedById: vi.fn().mockResolvedValue(existing),
    markUploaded: vi.fn(),
    retryFailed: vi.fn(),
  };
  const storage = {
    createObjectKey: vi.fn().mockReturnValue(key),
    createPresignedUploadUrl: vi.fn().mockResolvedValue("http://storage/upload"),
    headObject: vi.fn().mockResolvedValue({
      contentLength: file.byteLength,
      contentType: "application/x-ndjson",
    }),
    getRangeStream: vi.fn().mockResolvedValue({
      stream: Readable.from([file]),
      contentLength: file.byteLength,
      contentType: "application/x-ndjson",
    }),
  };

  return {
    repository,
    storage,
    service: new ImportService(
      repository as unknown as ImportRepository,
      storage as unknown as StorageService,
      environment,
    ),
  };
}

describe("ImportService", () => {
  it("creates an owner-scoped reservation and conditional upload URL", async () => {
    const { service, repository, storage } = createMocks();

    const result = await service.create(ownerId, {
      idempotency_key: "upload-1",
      format: "ndjson",
      filename: "contacts.ndjson",
      declared_size_bytes: file.byteLength,
    });

    expect(repository.createOrGet).toHaveBeenCalledWith(expect.objectContaining({
      ownerId,
      sourceObjectPath: key,
    }));
    expect(storage.createPresignedUploadUrl).toHaveBeenCalledWith(
      key,
      "application/x-ndjson",
      expect.any(Number),
    );
    expect(result.response).toMatchObject({
      job_id: jobId,
      upload_required: true,
      upload_headers: {
        "Content-Type": "application/x-ndjson",
        "If-None-Match": "*",
      },
    });
  });

  it("rejects an idempotency replay with different metadata", async () => {
    const { service, storage } = createMocks(reservation({ originalName: "other.ndjson" }));

    await expect(service.create(ownerId, {
      idempotency_key: "upload-1",
      format: "ndjson",
      filename: "contacts.ndjson",
      declared_size_bytes: file.byteLength,
    })).rejects.toBeInstanceOf(ImportMetadataConflictError);
    expect(storage.createPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it("finalizes idempotently by hashing the stored bytes", async () => {
    const finalized = reservation({
      contentHash: createHash("sha256").update(file).digest("hex"),
      uploadedAt: new Date(),
    });
    const { service, repository } = createMocks();
    repository.markUploaded.mockResolvedValue(finalized);

    const result = await service.finalize(ownerId, jobId);

    expect(repository.markUploaded).toHaveBeenCalledWith(
      ownerId,
      jobId,
      finalized.contentHash,
      expect.any(Date),
    );
    expect(result.content_hash).toBe(finalized.contentHash);
  });

  it("does not finalize an object with mismatched size", async () => {
    const { service, storage, repository } = createMocks();
    storage.headObject.mockResolvedValue({
      contentLength: file.byteLength + 1,
      contentType: "application/x-ndjson",
    });

    await expect(service.finalize(ownerId, jobId))
      .rejects.toBeInstanceOf(ImportUploadMetadataMismatchError);
    expect(repository.markUploaded).not.toHaveBeenCalled();
  });

  it("maps a missing storage object to an import conflict", async () => {
    const { service, storage } = createMocks();
    storage.headObject.mockRejectedValue(new StorageError(
      "STORAGE_OBJECT_NOT_FOUND",
      "not found",
    ));

    await expect(service.finalize(ownerId, jobId))
      .rejects.toBeInstanceOf(ImportUploadMissingError);
  });

  it("returns a stable owner-scoped progress response", async () => {
    const { service } = createMocks(reservation({
      totalBytes: 100,
      processedBytes: 33,
      lastLineNumber: 5,
      importedCount: 3,
      failedCount: 1,
      duplicateCount: 1,
    }));

    await expect(service.getStatus(ownerId, jobId)).resolves.toEqual({
      id: jobId,
      format: "ndjson",
      status: "pending",
      total_bytes: 100,
      processed_bytes: 33,
      last_line_number: 5,
      imported_count: 3,
      failed_count: 1,
      duplicate_count: 1,
      progress_percent: 33,
      created_at: "2026-08-13T09:00:00.000Z",
      updated_at: "2026-08-13T09:01:00.000Z",
      finished_at: null,
    });
  });

  it("handles zero-byte progress without dividing by zero", async () => {
    const { service } = createMocks(reservation({ totalBytes: 0 }));

    await expect(service.getStatus(ownerId, jobId)).resolves.toMatchObject({
      progress_percent: 0,
    });
  });

  it("returns not found when the owner-scoped job does not exist", async () => {
    const { service, repository } = createMocks();
    repository.findOwnedById.mockResolvedValue(null);

    await expect(service.getStatus(ownerId, jobId)).rejects.toBeInstanceOf(ImportNotFoundError);
  });

  it("retries a finalized failed job without resetting its checkpoint", async () => {
    const failed = reservation({
      status: "failed",
      totalBytes: 100,
      processedBytes: 50,
      lastLineNumber: 8,
      importedCount: 5,
      failedCount: 2,
      duplicateCount: 1,
      contentHash: "a".repeat(64),
      uploadedAt: new Date("2026-08-13T09:00:30.000Z"),
      finishedAt: new Date("2026-08-13T09:01:00.000Z"),
    });
    const retried = reservation({ ...failed, status: "pending", finishedAt: null });
    const { service, repository } = createMocks(failed);
    repository.retryFailed.mockResolvedValue(retried);

    const result = await service.retry(ownerId, jobId);

    expect(repository.retryFailed).toHaveBeenCalledWith(ownerId, jobId, expect.any(Date));
    expect(result).toMatchObject({
      retried: true,
      job: {
        id: jobId,
        status: "pending",
        processed_bytes: 50,
        last_line_number: 8,
        imported_count: 5,
        failed_count: 2,
        duplicate_count: 1,
      },
    });
  });

  it("treats retry of a completed job as an idempotent no-op", async () => {
    const completed = reservation({
      status: "completed",
      processedBytes: file.byteLength,
      contentHash: "a".repeat(64),
      uploadedAt: new Date(),
      finishedAt: new Date(),
    });
    const { service, repository } = createMocks(completed);

    await expect(service.retry(ownerId, jobId)).resolves.toMatchObject({
      retried: false,
      job: { id: jobId, status: "completed", progress_percent: 100 },
    });
    expect(repository.retryFailed).not.toHaveBeenCalled();
  });

  it("rejects retry while a job is pending or running", async () => {
    const { service, repository } = createMocks();

    await expect(service.retry(ownerId, jobId))
      .rejects.toBeInstanceOf(ImportRetryNotAllowedError);
    expect(repository.retryFailed).not.toHaveBeenCalled();
  });
});
