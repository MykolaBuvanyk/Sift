import type { Contact, ImportRowError } from "@sift/contracts";

export const IMPORT_ROW_ERROR_CODES = {
  lineTooLong: "IMPORT_ROW.LINE_TOO_LONG",
  invalidUtf8: "IMPORT_ROW.INVALID_UTF8",
  invalidJson: "IMPORT_ROW.INVALID_JSON",
  invalidContact: "IMPORT_ROW.INVALID_CONTACT",
} as const;

interface ImportRowBase {
  readonly lineNumber: number;
  readonly startByte: number;
  readonly checkpointBytes: number;
}

export interface ValidImportRow extends ImportRowBase {
  readonly kind: "valid";
  readonly contact: Contact;
}

export interface InvalidImportRow extends ImportRowBase {
  readonly kind: "error";
  readonly error: ImportRowError;
}

export type ParsedImportRow = ValidImportRow | InvalidImportRow;
export type ParsedNdjsonRow = ParsedImportRow;

export interface ImportBatch {
  readonly rows: readonly ParsedImportRow[];
  /** Checkpoint committed only after every row in this batch is committed. */
  readonly processedBytes: number;
  readonly lastLineNumber: number;
}

export type NdjsonBatch = ImportBatch;

export interface NdjsonParserOptions {
  readonly maxLineBytes: number;
  readonly batchSize: number;
  readonly initialByteOffset?: number;
  readonly initialLineNumber?: number;
}
