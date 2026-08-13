import type { NdjsonBatch } from "./ndjson-parser.types.js";

export interface ClaimedImportJob {
  readonly id: string;
  readonly ownerId: string;
  readonly sourceObjectPath: string;
  readonly format: "ndjson";
  readonly totalBytes: number;
  readonly processedBytes: number;
  readonly lastLineNumber: number;
  readonly importedCount: number;
  readonly failedCount: number;
  readonly duplicateCount: number;
  readonly leaseToken: string;
  readonly leaseExpiresAt: Date;
}

export interface CommitImportBatchInput {
  readonly job: ClaimedImportJob;
  readonly batch: NdjsonBatch;
  readonly leaseSeconds: number;
}

export interface CommittedImportProgress {
  readonly processedBytes: number;
  readonly lastLineNumber: number;
  readonly importedCount: number;
  readonly failedCount: number;
  readonly duplicateCount: number;
  readonly leaseExpiresAt: Date;
  readonly replayed: boolean;
}
