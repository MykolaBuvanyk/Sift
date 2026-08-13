export interface ImportReservation {
  readonly id: string;
  readonly ownerId: string;
  readonly idempotencyKey: string;
  readonly originalName: string | null;
  readonly sourceObjectPath: string;
  readonly format: "ndjson" | "csv";
  readonly status: "pending" | "running" | "completed" | "failed";
  readonly totalBytes: number;
  readonly processedBytes: number;
  readonly lastLineNumber: number;
  readonly importedCount: number;
  readonly failedCount: number;
  readonly duplicateCount: number;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly contentHash: string | null;
  readonly uploadedAt: Date | null;
  readonly reservationExpiresAt: Date | null;
  readonly cleanupToken: string | null;
  readonly claimedAt: Date | null;
  readonly leaseExpiresAt: Date | null;
  readonly leaseToken: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly finishedAt: Date | null;
}

export interface CreateReservationInput {
  readonly ownerId: string;
  readonly idempotencyKey: string;
  readonly originalName: string;
  readonly sourceObjectPath: string;
  readonly format: "ndjson" | "csv";
  readonly totalBytes: number;
  readonly reservationExpiresAt: Date;
}

export interface CleanupReservation {
  readonly id: string;
  readonly sourceObjectPath: string;
  readonly cleanupToken: string;
}
