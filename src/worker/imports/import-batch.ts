import { ImportInvariantError } from "./import-worker.errors.js";
import type { CommitImportBatchInput } from "./import-worker.types.js";
import type { ParsedImportRow } from "./ndjson-parser.types.js";

type ValidRow = Extract<ParsedImportRow, { kind: "valid" }>;
type InvalidRow = Extract<ParsedImportRow, { kind: "error" }>;

export interface PartitionedImportBatch {
  readonly validRows: readonly ValidRow[];
  readonly invalidRows: readonly InvalidRow[];
  readonly firstContactByEmail: ReadonlyMap<string, ValidRow["contact"]>;
}

export function validateImportBatch({ job, batch }: CommitImportBatchInput): void {
  if (batch.rows.length === 0) {
    throw new ImportInvariantError("An empty import batch cannot be committed.");
  }
  if (batch.processedBytes <= job.processedBytes || batch.processedBytes > job.totalBytes) {
    throw new ImportInvariantError("The import batch byte checkpoint is outside the job range.");
  }
  if (batch.lastLineNumber !== job.lastLineNumber + batch.rows.length) {
    throw new ImportInvariantError("The import batch line checkpoint is not contiguous.");
  }

  let expectedLineNumber = job.lastLineNumber + 1;
  let previousCheckpoint = job.processedBytes;
  for (const row of batch.rows) {
    if (row.lineNumber !== expectedLineNumber || row.checkpointBytes <= previousCheckpoint) {
      throw new ImportInvariantError("The import batch contains a non-contiguous row checkpoint.");
    }
    expectedLineNumber += 1;
    previousCheckpoint = row.checkpointBytes;
  }
  if (previousCheckpoint !== batch.processedBytes) {
    throw new ImportInvariantError("The batch checkpoint does not match its final row.");
  }
}

export function partitionImportBatch(
  rows: readonly ParsedImportRow[],
): PartitionedImportBatch {
  const validRows: ValidRow[] = [];
  const invalidRows: InvalidRow[] = [];
  const firstContactByEmail = new Map<string, ValidRow["contact"]>();

  for (const row of rows) {
    if (row.kind === "error") {
      invalidRows.push(row);
      continue;
    }
    validRows.push(row);
    if (!firstContactByEmail.has(row.contact.email)) {
      firstContactByEmail.set(row.contact.email, row.contact);
    }
  }

  return { validRows, invalidRows, firstContactByEmail };
}
