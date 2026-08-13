import type { Contact, ImportRowError } from "@sift/contracts";

export const IMPORT_ROW_ERROR_CODES = {
  lineTooLong: "IMPORT_ROW.LINE_TOO_LONG",
  invalidUtf8: "IMPORT_ROW.INVALID_UTF8",
  invalidJson: "IMPORT_ROW.INVALID_JSON",
  invalidContact: "IMPORT_ROW.INVALID_CONTACT",
} as const;

interface NdjsonRowBase {
  readonly lineNumber: number;
  readonly startByte: number;
  readonly checkpointBytes: number;
}

export interface ValidNdjsonRow extends NdjsonRowBase {
  readonly kind: "valid";
  readonly contact: Contact;
}

export interface InvalidNdjsonRow extends NdjsonRowBase {
  readonly kind: "error";
  readonly error: ImportRowError;
}

export type ParsedNdjsonRow = ValidNdjsonRow | InvalidNdjsonRow;

export interface NdjsonBatch {
  readonly rows: readonly ParsedNdjsonRow[];
  /** Checkpoint committed only after every row in this batch is committed. */
  readonly processedBytes: number;
  readonly lastLineNumber: number;
}

export interface NdjsonParserOptions {
  readonly maxLineBytes: number;
  readonly batchSize: number;
  readonly initialByteOffset?: number;
  readonly initialLineNumber?: number;
}
