import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";

import { DatabaseService } from "../../database/database.service.js";
import { importJobs } from "../../database/schema.js";
import type {
  CleanupReservation,
  CreateReservationInput,
  ImportReservation,
} from "./import.types.js";

type ImportJobRow = typeof importJobs.$inferSelect;

@Injectable()
export class ImportRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async createOrGet(input: CreateReservationInput): Promise<{
    reservation: ImportReservation;
    created: boolean;
  }> {
    const [created] = await this.database.client
      .insert(importJobs)
      .values(input)
      .onConflictDoNothing({ target: [importJobs.ownerId, importJobs.idempotencyKey] })
      .returning();

    if (created) {
      return { reservation: this.toReservation(created), created: true };
    }

    const existing = await this.findByIdempotencyKey(input.ownerId, input.idempotencyKey);
    if (!existing) {
      throw new Error("Import idempotency conflict did not resolve to an existing row.");
    }

    return { reservation: existing, created: false };
  }

  async findOwnedById(ownerId: string, id: string): Promise<ImportReservation | null> {
    const [row] = await this.database.client
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.id, id), eq(importJobs.ownerId, ownerId)))
      .limit(1);

    return row ? this.toReservation(row) : null;
  }

  async markUploaded(
    ownerId: string,
    id: string,
    contentHash: string,
    uploadedAt: Date,
  ): Promise<ImportReservation | null> {
    const [row] = await this.database.client
      .update(importJobs)
      .set({ contentHash, uploadedAt, updatedAt: uploadedAt })
      .where(and(
        eq(importJobs.id, id),
        eq(importJobs.ownerId, ownerId),
        isNull(importJobs.uploadedAt),
        isNull(importJobs.cleanupToken),
        gt(importJobs.reservationExpiresAt, uploadedAt),
      ))
      .returning();

    return row ? this.toReservation(row) : null;
  }

  async retryFailed(
    ownerId: string,
    id: string,
    retriedAt: Date,
  ): Promise<ImportReservation | null> {
    const [row] = await this.database.client
      .update(importJobs)
      .set({
        status: "pending",
        finishedAt: null,
        failureCode: null,
        failureMessage: null,
        updatedAt: retriedAt,
      })
      .where(and(
        eq(importJobs.id, id),
        eq(importJobs.ownerId, ownerId),
        eq(importJobs.status, "failed"),
        isNotNull(importJobs.uploadedAt),
        isNull(importJobs.claimedAt),
        isNull(importJobs.leaseExpiresAt),
        isNull(importJobs.leaseToken),
      ))
      .returning();

    return row ? this.toReservation(row) : null;
  }

  async claimExpiredForCleanup(
    batchSize: number,
    staleClaimSeconds: number,
  ): Promise<CleanupReservation[]> {
    const cleanupToken = randomUUID();
    const result = await this.database.client.execute(sql`
      with candidates as (
        select id
        from import_jobs
        where uploaded_at is null
          and reservation_expires_at is not null
          and reservation_expires_at <= now()
          and (
            cleanup_claimed_at is null
            or cleanup_claimed_at < now() - (${staleClaimSeconds} * interval '1 second')
          )
        order by reservation_expires_at
        for update skip locked
        limit ${batchSize}
      )
      update import_jobs as jobs
      set cleanup_claimed_at = now(), cleanup_token = ${cleanupToken}, updated_at = now()
      from candidates
      where jobs.id = candidates.id
      returning jobs.id, jobs.source_object_path
    `);

    return (result.rows as Array<{ id: string; source_object_path: string }>).map((row) => ({
      id: row.id,
      sourceObjectPath: row.source_object_path,
      cleanupToken,
    }));
  }

  async completeCleanup(id: string, cleanupToken: string): Promise<boolean> {
    const deleted = await this.database.client
      .delete(importJobs)
      .where(and(
        eq(importJobs.id, id),
        eq(importJobs.cleanupToken, cleanupToken),
        isNull(importJobs.uploadedAt),
      ))
      .returning({ id: importJobs.id });

    return deleted.length === 1;
  }

  async releaseCleanupClaim(id: string, cleanupToken: string): Promise<void> {
    await this.database.client
      .update(importJobs)
      .set({ cleanupClaimedAt: null, cleanupToken: null, updatedAt: new Date() })
      .where(and(eq(importJobs.id, id), eq(importJobs.cleanupToken, cleanupToken)));
  }

  private async findByIdempotencyKey(
    ownerId: string,
    idempotencyKey: string,
  ): Promise<ImportReservation | null> {
    const [row] = await this.database.client
      .select()
      .from(importJobs)
      .where(and(
        eq(importJobs.ownerId, ownerId),
        eq(importJobs.idempotencyKey, idempotencyKey),
      ))
      .limit(1);

    return row ? this.toReservation(row) : null;
  }

  private toReservation(row: ImportJobRow): ImportReservation {
    return {
      id: row.id,
      ownerId: row.ownerId,
      idempotencyKey: row.idempotencyKey,
      originalName: row.originalName,
      sourceObjectPath: row.sourceObjectPath,
      format: row.format,
      status: row.status,
      totalBytes: row.totalBytes,
      processedBytes: row.processedBytes,
      lastLineNumber: row.lastLineNumber,
      importedCount: row.importedCount,
      failedCount: row.failedCount,
      duplicateCount: row.duplicateCount,
      failureCode: row.failureCode,
      failureMessage: row.failureMessage,
      contentHash: row.contentHash,
      uploadedAt: row.uploadedAt,
      reservationExpiresAt: row.reservationExpiresAt,
      cleanupToken: row.cleanupToken,
      claimedAt: row.claimedAt,
      leaseExpiresAt: row.leaseExpiresAt,
      leaseToken: row.leaseToken,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      finishedAt: row.finishedAt,
    };
  }
}
