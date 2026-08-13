import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import type {
  CreateImportResponse,
  FinalizeImportResponse,
  ImportJob,
  RetryImportResponse,
} from "@sift/contracts";

import { ENVIRONMENT } from "../../config/environment.module.js";
import type { Environment } from "../../config/environment.js";
import { StorageError } from "../../storage/storage.error.js";
import { StorageService } from "../../storage/storage.service.js";
import type { CreateImportDto } from "./dto/create-import.dto.js";
import {
  ImportFileTooLargeError,
  ImportFinalizeTimeoutError,
  ImportMetadataConflictError,
  ImportNotFoundError,
  ImportReservationExpiredError,
  ImportRetryNotAllowedError,
  ImportStorageUnavailableError,
  ImportUploadMetadataMismatchError,
  ImportUploadMissingError,
} from "./import.errors.js";
import { ImportRepository } from "./import.repository.js";
import type { ImportReservation } from "./import.types.js";

const CONTENT_TYPES = {
  ndjson: "application/x-ndjson",
  csv: "text/csv",
} as const;

class HashTimeoutError extends Error {}

export interface CreateImportResult {
  readonly created: boolean;
  readonly response: CreateImportResponse;
}

@Injectable()
export class ImportService {
  constructor(
    @Inject(ImportRepository) private readonly imports: ImportRepository,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  async create(ownerId: string, metadata: CreateImportDto): Promise<CreateImportResult> {
    this.assertSizeAllowed(metadata.declared_size_bytes);

    const now = new Date();
    const reservationExpiresAt = new Date(
      now.getTime() + this.environment.IMPORT_RESERVATION_TTL_SECONDS * 1_000,
    );
    const result = await this.imports.createOrGet({
      ownerId,
      idempotencyKey: metadata.idempotency_key,
      originalName: metadata.filename,
      sourceObjectPath: this.storage.createObjectKey(ownerId),
      format: metadata.format,
      totalBytes: metadata.declared_size_bytes,
      reservationExpiresAt,
    });

    this.assertMetadataMatches(result.reservation, metadata);
    const response = await this.buildCreateResponse(result.reservation, now);
    return { created: result.created, response };
  }

  async finalize(ownerId: string, id: string): Promise<FinalizeImportResponse> {
    const reservation = await this.imports.findOwnedById(ownerId, id);
    if (!reservation) {
      throw new ImportNotFoundError();
    }
    if (reservation.uploadedAt) {
      return this.toFinalizeResponse(reservation);
    }

    this.assertReservationActive(reservation, new Date());
    const expectedContentType = CONTENT_TYPES[reservation.format];
    const metadata = await this.readObjectMetadata(reservation.sourceObjectPath);
    this.assertObjectMetadata(reservation, expectedContentType, metadata);
    const contentHash = await this.hashObject(
      reservation.sourceObjectPath,
      reservation.totalBytes,
      expectedContentType,
    );

    const uploadedAt = new Date();
    const finalized = await this.imports.finalizeUpload(ownerId, id, contentHash, uploadedAt);
    if (finalized?.deduplicated) {
      await this.storage.deleteObject(reservation.sourceObjectPath);
      await this.imports.deleteUnuploadedReservation(ownerId, id);
      return this.toFinalizeResponse(finalized.reservation);
    }
    if (finalized) {
      return this.toFinalizeResponse(finalized.reservation);
    }

    const current = await this.imports.findOwnedById(ownerId, id);
    if (current?.uploadedAt) {
      return this.toFinalizeResponse(current);
    }
    if (!current) {
      throw new ImportNotFoundError();
    }
    throw new ImportReservationExpiredError();
  }

  async getStatus(ownerId: string, id: string): Promise<ImportJob> {
    const job = await this.imports.findOwnedById(ownerId, id);
    if (!job) {
      throw new ImportNotFoundError();
    }

    return this.toImportJob(job);
  }

  async retry(ownerId: string, id: string): Promise<RetryImportResponse> {
    const current = await this.imports.findOwnedById(ownerId, id);
    if (!current) {
      throw new ImportNotFoundError();
    }
    if (current.status === "completed") {
      return { job: this.toImportJob(current), retried: false };
    }
    if (current.status !== "failed" || !current.uploadedAt || !current.contentHash) {
      throw new ImportRetryNotAllowedError();
    }

    const retried = await this.imports.retryFailed(ownerId, id, new Date());
    if (retried) {
      return { job: this.toImportJob(retried), retried: true };
    }

    const latest = await this.imports.findOwnedById(ownerId, id);
    if (!latest) {
      throw new ImportNotFoundError();
    }
    if (latest.status === "completed") {
      return { job: this.toImportJob(latest), retried: false };
    }
    throw new ImportRetryNotAllowedError();
  }

  private async buildCreateResponse(
    reservation: ImportReservation,
    now: Date,
  ): Promise<CreateImportResponse> {
    if (!reservation.reservationExpiresAt) {
      throw new ImportReservationExpiredError();
    }

    if (reservation.uploadedAt) {
      return {
        job_id: reservation.id,
        status: reservation.status,
        upload_required: false,
        upload_url: null,
        upload_method: null,
        upload_headers: {},
        upload_url_expires_at: null,
        reservation_expires_at: reservation.reservationExpiresAt.toISOString(),
      };
    }

    this.assertReservationActive(reservation, now);
    const remainingSeconds = Math.max(
      1,
      Math.floor((reservation.reservationExpiresAt.getTime() - now.getTime()) / 1_000),
    );
    const expiresInSeconds = Math.min(
      remainingSeconds,
      this.environment.S3_PRESIGN_TTL_SECONDS,
    );
    const contentType = CONTENT_TYPES[reservation.format];
    const uploadUrl = await this.runStorageOperation(() =>
      this.storage.createPresignedUploadUrl(
        reservation.sourceObjectPath,
        contentType,
        expiresInSeconds,
      )
    );

    return {
      job_id: reservation.id,
      status: reservation.status,
      upload_required: true,
      upload_url: uploadUrl,
      upload_method: "PUT",
      upload_headers: {
        "Content-Type": contentType,
        "If-None-Match": "*",
      },
      upload_url_expires_at: new Date(now.getTime() + expiresInSeconds * 1_000).toISOString(),
      reservation_expires_at: reservation.reservationExpiresAt.toISOString(),
    };
  }

  private async readObjectMetadata(key: string): Promise<{
    contentLength: number;
    contentType?: string;
  }> {
    try {
      return await this.storage.headObject(key);
    } catch (error: unknown) {
      if (error instanceof StorageError && error.code === "STORAGE_OBJECT_NOT_FOUND") {
        throw new ImportUploadMissingError();
      }
      this.throwStorageError(error);
    }
  }

  private async hashObject(
    key: string,
    expectedBytes: number,
    expectedContentType: string,
  ): Promise<string> {
    const object = await this.runStorageOperation(() => this.storage.getRangeStream(key, 0));
    if (object.contentLength !== expectedBytes) {
      throw new ImportUploadMetadataMismatchError({
        expectedSize: expectedBytes,
        actualSize: object.contentLength,
        expectedContentType,
        ...(object.contentType === undefined ? {} : { actualContentType: object.contentType }),
      });
    }

    const hash = createHash("sha256");
    let bytesRead = 0;
    const timeoutError = new HashTimeoutError();
    const timeout = setTimeout(() => object.stream.destroy(timeoutError), this.environment.IMPORT_FINALIZE_TIMEOUT_MS);
    timeout.unref();

    try {
      for await (const chunk of object.stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        bytesRead += buffer.byteLength;
        hash.update(buffer);
      }
    } catch (error: unknown) {
      if (error === timeoutError || error instanceof HashTimeoutError) {
        throw new ImportFinalizeTimeoutError();
      }
      throw new ImportStorageUnavailableError(error);
    } finally {
      clearTimeout(timeout);
    }

    if (bytesRead !== expectedBytes) {
      throw new ImportUploadMetadataMismatchError({
        expectedSize: expectedBytes,
        actualSize: bytesRead,
        expectedContentType,
        ...(object.contentType === undefined ? {} : { actualContentType: object.contentType }),
      });
    }

    return hash.digest("hex");
  }

  private assertSizeAllowed(declaredSizeBytes: number): void {
    if (declaredSizeBytes > this.environment.IMPORT_MAX_BYTES) {
      throw new ImportFileTooLargeError(this.environment.IMPORT_MAX_BYTES);
    }
  }

  private assertMetadataMatches(reservation: ImportReservation, metadata: CreateImportDto): void {
    if (
      reservation.format !== metadata.format
      || reservation.totalBytes !== metadata.declared_size_bytes
      || reservation.originalName !== metadata.filename
    ) {
      throw new ImportMetadataConflictError();
    }
  }

  private assertReservationActive(reservation: ImportReservation, now: Date): void {
    if (
      !reservation.reservationExpiresAt
      || reservation.reservationExpiresAt <= now
      || reservation.cleanupToken
    ) {
      throw new ImportReservationExpiredError();
    }
  }

  private assertObjectMetadata(
    reservation: ImportReservation,
    expectedContentType: string,
    metadata: { contentLength: number; contentType?: string },
  ): void {
    if (
      metadata.contentLength !== reservation.totalBytes
      || metadata.contentType !== expectedContentType
    ) {
      throw new ImportUploadMetadataMismatchError({
        expectedSize: reservation.totalBytes,
        actualSize: metadata.contentLength,
        expectedContentType,
        ...(metadata.contentType === undefined ? {} : { actualContentType: metadata.contentType }),
      });
    }
  }

  private toFinalizeResponse(reservation: ImportReservation): FinalizeImportResponse {
    if (!reservation.uploadedAt || !reservation.contentHash) {
      throw new Error("Finalized import is missing upload metadata.");
    }

    return {
      job_id: reservation.id,
      status: reservation.status,
      content_hash: reservation.contentHash,
      total_bytes: reservation.totalBytes,
      uploaded_at: reservation.uploadedAt.toISOString(),
    };
  }

  private toImportJob(job: ImportReservation): ImportJob {
    const progressPercent = job.totalBytes === 0
      ? (job.status === "completed" ? 100 : 0)
      : Math.round((job.processedBytes / job.totalBytes) * 10_000) / 100;

    return {
      id: job.id,
      format: job.format,
      status: job.status,
      total_bytes: job.totalBytes,
      processed_bytes: job.processedBytes,
      last_line_number: job.lastLineNumber,
      imported_count: job.importedCount,
      failed_count: job.failedCount,
      duplicate_count: job.duplicateCount,
      progress_percent: Math.min(100, Math.max(0, progressPercent)),
      created_at: job.createdAt.toISOString(),
      updated_at: job.updatedAt.toISOString(),
      finished_at: job.finishedAt?.toISOString() ?? null,
    };
  }

  private async runStorageOperation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      this.throwStorageError(error);
    }
  }

  private throwStorageError(error: unknown): never {
    if (error instanceof StorageError && error.code === "STORAGE_OBJECT_NOT_FOUND") {
      throw new ImportUploadMissingError();
    }
    if (error instanceof StorageError && error.code === "STORAGE_TIMEOUT") {
      throw new ImportFinalizeTimeoutError();
    }
    throw new ImportStorageUnavailableError(error);
  }
}
