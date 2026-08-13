import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gt, isNotNull, lte, or } from "drizzle-orm";

import { DatabaseService } from "../../server/database/database.service.js";
import {
  contacts,
  importJobs,
  importJobSeenContacts,
  importRowErrors,
} from "../../server/database/schema.js";
import { partitionImportBatch, validateImportBatch } from "./import-batch.js";
import {
  ImportCheckpointConflictError,
  ImportInvariantError,
  ImportLeaseLostError,
} from "./import-worker.errors.js";
import type {
  ClaimedImportJob,
  CommitImportBatchInput,
  CommittedImportProgress,
} from "./import-worker.types.js";

@Injectable()
export class ImportWorkerRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async claimNext(leaseSeconds: number, now = new Date()): Promise<ClaimedImportJob | null> {
    const leaseToken = randomUUID();
    const leaseExpiresAt = addSeconds(now, leaseSeconds);

    return this.database.client.transaction(async (transaction) => {
      const [candidate] = await transaction
        .select()
        .from(importJobs)
        .where(and(
          eq(importJobs.format, "ndjson"),
          isNotNull(importJobs.uploadedAt),
          or(
            eq(importJobs.status, "pending"),
            and(eq(importJobs.status, "running"), lte(importJobs.leaseExpiresAt, now)),
          ),
        ))
        .orderBy(asc(importJobs.createdAt))
        .limit(1)
        .for("update", { skipLocked: true });

      if (!candidate) {
        return null;
      }

      const [claimed] = await transaction
        .update(importJobs)
        .set({
          status: "running",
          claimedAt: now,
          leaseExpiresAt,
          leaseToken,
          finishedAt: null,
          failureCode: null,
          failureMessage: null,
          updatedAt: now,
        })
        .where(eq(importJobs.id, candidate.id))
        .returning();

      if (!claimed) {
        throw new ImportInvariantError("A locked import job could not be claimed.");
      }

      return toClaimedJob(claimed, leaseToken, leaseExpiresAt);
    });
  }

  async commitBatch(input: CommitImportBatchInput): Promise<CommittedImportProgress> {
    validateImportBatch(input);

    return this.database.client.transaction(async (transaction) => {
      const [lockedJob] = await transaction
        .select()
        .from(importJobs)
        .where(and(
          eq(importJobs.id, input.job.id),
          eq(importJobs.status, "running"),
          eq(importJobs.leaseToken, input.job.leaseToken),
        ))
        .limit(1)
        .for("update");

      if (!lockedJob) {
        throw new ImportLeaseLostError();
      }
      if (!lockedJob.leaseExpiresAt || lockedJob.leaseExpiresAt <= new Date()) {
        throw new ImportLeaseLostError();
      }

      if (
        lockedJob.processedBytes === input.batch.processedBytes
        && lockedJob.lastLineNumber === input.batch.lastLineNumber
      ) {
        const replayedAt = new Date();
        const [renewed] = await transaction
          .update(importJobs)
          .set({
            leaseExpiresAt: addSeconds(replayedAt, input.leaseSeconds),
            updatedAt: replayedAt,
          })
          .where(and(
            eq(importJobs.id, input.job.id),
            eq(importJobs.status, "running"),
            eq(importJobs.leaseToken, input.job.leaseToken),
            gt(importJobs.leaseExpiresAt, replayedAt),
          ))
          .returning();
        if (!renewed) {
          throw new ImportLeaseLostError();
        }
        return toCommittedProgress(renewed, true);
      }

      if (
        lockedJob.processedBytes !== input.job.processedBytes
        || lockedJob.lastLineNumber !== input.job.lastLineNumber
      ) {
        throw new ImportCheckpointConflictError();
      }

      const { validRows, invalidRows, firstContactByEmail } = partitionImportBatch(
        input.batch.rows,
      );

      const newlySeen = validRows.length === 0
        ? []
        : await transaction
          .insert(importJobSeenContacts)
          .values(validRows.map((row) => ({
            jobId: input.job.id,
            email: row.contact.email,
          })))
          .onConflictDoNothing()
          .returning({ email: importJobSeenContacts.email });

      const insertedContacts = newlySeen.length === 0
        ? []
        : await transaction
          .insert(contacts)
          .values(newlySeen.map(({ email }) => {
            const contact = firstContactByEmail.get(email);
            if (!contact) {
              throw new ImportInvariantError("A newly seen email has no parsed contact.");
            }
            return {
              ownerId: input.job.ownerId,
              email: contact.email,
              fullName: contact.full_name,
              phone: contact.phone ?? null,
              tags: contact.tags,
            };
          }))
          .onConflictDoNothing()
          .returning({ email: contacts.email });

      if (invalidRows.length > 0) {
        await transaction
          .insert(importRowErrors)
          .values(invalidRows.map((row) => ({
            jobId: input.job.id,
            lineNumber: row.error.line_number,
            errorCode: row.error.error_code,
            message: row.error.message,
            rawExcerpt: row.error.raw_excerpt,
          })))
          .onConflictDoNothing();
      }

      const importedDelta = insertedContacts.length;
      const failedDelta = invalidRows.length;
      const duplicateDelta = validRows.length - importedDelta;
      const committedAt = new Date();
      const leaseExpiresAt = addSeconds(committedAt, input.leaseSeconds);
      const [updated] = await transaction
        .update(importJobs)
        .set({
          processedBytes: input.batch.processedBytes,
          lastLineNumber: input.batch.lastLineNumber,
          importedCount: lockedJob.importedCount + importedDelta,
          failedCount: lockedJob.failedCount + failedDelta,
          duplicateCount: lockedJob.duplicateCount + duplicateDelta,
          leaseExpiresAt,
          updatedAt: committedAt,
        })
        .where(and(
          eq(importJobs.id, input.job.id),
          eq(importJobs.status, "running"),
          eq(importJobs.leaseToken, input.job.leaseToken),
          gt(importJobs.leaseExpiresAt, committedAt),
          eq(importJobs.processedBytes, input.job.processedBytes),
          eq(importJobs.lastLineNumber, input.job.lastLineNumber),
        ))
        .returning();

      if (!updated) {
        throw new ImportLeaseLostError();
      }

      return toCommittedProgress(updated, false);
    });
  }

  async complete(job: ClaimedImportJob, finishedAt = new Date()): Promise<boolean> {
    const [completed] = await this.database.client
      .update(importJobs)
      .set({
        status: "completed",
        claimedAt: null,
        leaseExpiresAt: null,
        leaseToken: null,
        finishedAt,
        failureCode: null,
        failureMessage: null,
        updatedAt: finishedAt,
      })
      .where(and(
        eq(importJobs.id, job.id),
        eq(importJobs.status, "running"),
        eq(importJobs.leaseToken, job.leaseToken),
        gt(importJobs.leaseExpiresAt, finishedAt),
        eq(importJobs.processedBytes, job.totalBytes),
        eq(importJobs.lastLineNumber, job.lastLineNumber),
        eq(importJobs.importedCount, job.importedCount),
        eq(importJobs.failedCount, job.failedCount),
        eq(importJobs.duplicateCount, job.duplicateCount),
      ))
      .returning({ id: importJobs.id });

    return completed !== undefined;
  }

  async release(jobId: string, leaseToken: string, releasedAt = new Date()): Promise<boolean> {
    const [released] = await this.database.client
      .update(importJobs)
      .set({
        status: "pending",
        claimedAt: null,
        leaseExpiresAt: null,
        leaseToken: null,
        updatedAt: releasedAt,
      })
      .where(and(
        eq(importJobs.id, jobId),
        eq(importJobs.status, "running"),
        eq(importJobs.leaseToken, leaseToken),
      ))
      .returning({ id: importJobs.id });

    return released !== undefined;
  }

  async fail(
    jobId: string,
    leaseToken: string,
    failureCode: string,
    failureMessage: string,
    failedAt = new Date(),
  ): Promise<boolean> {
    const [failed] = await this.database.client
      .update(importJobs)
      .set({
        status: "failed",
        claimedAt: null,
        leaseExpiresAt: null,
        leaseToken: null,
        failureCode,
        failureMessage,
        finishedAt: failedAt,
        updatedAt: failedAt,
      })
      .where(and(
        eq(importJobs.id, jobId),
        eq(importJobs.status, "running"),
        eq(importJobs.leaseToken, leaseToken),
        gt(importJobs.leaseExpiresAt, failedAt),
      ))
      .returning({ id: importJobs.id });

    return failed !== undefined;
  }
}

function toClaimedJob(
  row: typeof importJobs.$inferSelect,
  leaseToken: string,
  leaseExpiresAt: Date,
): ClaimedImportJob {
  if (row.format !== "ndjson") {
    throw new ImportInvariantError("Only NDJSON jobs may be claimed by this worker.");
  }

  return {
    id: row.id,
    ownerId: row.ownerId,
    sourceObjectPath: row.sourceObjectPath,
    format: row.format,
    totalBytes: row.totalBytes,
    processedBytes: row.processedBytes,
    lastLineNumber: row.lastLineNumber,
    importedCount: row.importedCount,
    failedCount: row.failedCount,
    duplicateCount: row.duplicateCount,
    leaseToken,
    leaseExpiresAt,
  };
}

function toCommittedProgress(
  row: typeof importJobs.$inferSelect,
  replayed: boolean,
): CommittedImportProgress {
  if (!row.leaseExpiresAt) {
    throw new ImportInvariantError("A running import job is missing its lease expiry.");
  }

  return {
    processedBytes: row.processedBytes,
    lastLineNumber: row.lastLineNumber,
    importedCount: row.importedCount,
    failedCount: row.failedCount,
    duplicateCount: row.duplicateCount,
    leaseExpiresAt: row.leaseExpiresAt,
    replayed,
  };
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1_000);
}
