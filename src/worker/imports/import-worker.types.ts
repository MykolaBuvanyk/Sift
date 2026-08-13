import type { ImportBatch } from "./ndjson-parser.types.js";

export interface ClaimedImportJob {
  readonly id: string;
  readonly ownerId: string;
  readonly sourceObjectPath: string;
  readonly format: "csv" | "ndjson";
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
  readonly batch: ImportBatch;
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
