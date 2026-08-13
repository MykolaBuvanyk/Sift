import {
  contactSchema,
  type Contact,
  type ImportRowError,
} from "@sift/contracts";

import type { ImportByteStream } from "./byte-line-reader.js";
import {
  type CsvByteRecord,
  readCsvRecords,
} from "./csv-record-reader.js";
import type {
  ImportBatch,
  ParsedImportRow,
} from "./ndjson-parser.types.js";

const RAW_EXCERPT_MAX_BYTES = 500;
const CSV_BATCH_SIZE_MAX = 1_000;
const REQUIRED_COLUMNS = new Set(["email", "full_name"]);
const ALLOWED_COLUMNS = new Set(["email", "full_name", "phone", "tags"]);

export const CSV_ROW_ERROR_CODES = {
  columnCount: "IMPORT_ROW.CSV_COLUMN_COUNT",
  invalidContact: "IMPORT_ROW.INVALID_CONTACT",
  invalidCsv: "IMPORT_ROW.INVALID_CSV",
  invalidUtf8: "IMPORT_ROW.INVALID_UTF8",
  recordTooLong: "IMPORT_ROW.RECORD_TOO_LONG",
} as const;

export interface CsvHeader {
  readonly columns: readonly string[];
}

export interface CsvParserOptions {
  readonly batchSize: number;
  readonly header?: CsvHeader;
  readonly initialByteOffset?: number;
  readonly initialLineNumber?: number;
  readonly maxRecordBytes: number;
}

export class CsvFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvFormatError";
  }
}

const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const excerptDecoder = new TextDecoder("utf-8");

export async function readCsvHeader(
  source: ImportByteStream,
  maxRecordBytes: number,
): Promise<CsvHeader> {
  for await (const record of readCsvRecords(source, { maxRecordBytes })) {
    return parseHeader(record);
  }
  throw new CsvFormatError("The CSV file is empty.");
}

export async function* parseCsvBatches(
  source: ImportByteStream,
  options: CsvParserOptions,
): AsyncGenerator<ImportBatch> {
  assertBatchSize(options.batchSize);

  let header = options.header;
  let lineNumber = options.initialLineNumber ?? 0;
  let rows: ParsedImportRow[] = [];
  let sawDataRecord = false;

  for await (const record of readCsvRecords(source, {
    initialByteOffset: options.initialByteOffset,
    maxRecordBytes: options.maxRecordBytes,
  })) {
    if (!header) {
      header = parseHeader(record);
      continue;
    }

    sawDataRecord = true;
    lineNumber += 1;
    rows.push(parseDataRecord(record, header, lineNumber));
    if (rows.length === options.batchSize) {
      yield createBatch(rows);
      rows = [];
    }
  }

  if (!header) {
    throw new CsvFormatError("The CSV file is empty.");
  }
  if (!options.header && !sawDataRecord) {
    throw new CsvFormatError("The CSV file contains a header but no data rows.");
  }
  if (rows.length > 0) {
    yield createBatch(rows);
  }
}

function parseHeader(record: CsvByteRecord): CsvHeader {
  if (record.tooLong) {
    throw new CsvFormatError("The CSV header exceeds the configured byte limit.");
  }
  const text = decodeRecord(record, "The CSV header is not valid UTF-8.");
  const parsed = parseCsvFields(text);
  if (!parsed) {
    throw new CsvFormatError("The CSV header has invalid quoting.");
  }
  const columns = parsed.map((column, index) => {
    const normalized = column.trim().toLowerCase();
    return index === 0 ? normalized.replace(/^\uFEFF/, "") : normalized;
  });
  if (new Set(columns).size !== columns.length) {
    throw new CsvFormatError("The CSV header contains duplicate columns.");
  }
  if (columns.some((column) => !ALLOWED_COLUMNS.has(column))) {
    throw new CsvFormatError("The CSV header contains an unsupported column.");
  }
  if ([...REQUIRED_COLUMNS].some((column) => !columns.includes(column))) {
    throw new CsvFormatError("The CSV header must contain email and full_name.");
  }
  return { columns };
}

function parseDataRecord(
  record: CsvByteRecord,
  header: CsvHeader,
  lineNumber: number,
): ParsedImportRow {
  if (record.tooLong) {
    return invalidRow(record, lineNumber, CSV_ROW_ERROR_CODES.recordTooLong, "The CSV row exceeds the configured byte limit.");
  }

  let text: string;
  try {
    text = fatalUtf8Decoder.decode(record.contentPrefix);
  } catch {
    return invalidRow(record, lineNumber, CSV_ROW_ERROR_CODES.invalidUtf8, "The CSV row is not valid UTF-8.");
  }
  const fields = parseCsvFields(text);
  if (!fields) {
    return invalidRow(record, lineNumber, CSV_ROW_ERROR_CODES.invalidCsv, "The CSV row has invalid quoting.");
  }
  if (fields.length !== header.columns.length) {
    return invalidRow(record, lineNumber, CSV_ROW_ERROR_CODES.columnCount, "The CSV row does not match the header column count.");
  }

  const contact = parseContact(header, fields);
  if (!contact) {
    return invalidRow(record, lineNumber, CSV_ROW_ERROR_CODES.invalidContact, "The CSV row does not match the contact schema.");
  }
  return {
    kind: "valid",
    lineNumber,
    startByte: record.startByte,
    checkpointBytes: record.checkpointBytes,
    contact,
  };
}

function parseContact(header: CsvHeader, fields: readonly string[]): Contact | null {
  const values = Object.fromEntries(header.columns.map((column, index) => [column, fields[index] ?? ""]));
  const tags = parseTags(values.tags ?? "");
  if (!tags) {
    return null;
  }
  const candidate = {
    email: (values.email ?? "").trim().toLowerCase(),
    full_name: values.full_name ?? "",
    ...(values.phone?.trim() ? { phone: values.phone } : {}),
    tags,
  };
  const parsed = contactSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function parseTags(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  if (!trimmed.startsWith("[")) {
    return trimmed.split("|").map((tag) => tag.trim()).filter(Boolean);
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) && parsed.every((tag) => typeof tag === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function parseCsvFields(record: string): string[] | null {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;

  for (let index = 0; index < record.length; index += 1) {
    const character = record[index] ?? "";
    if (inQuotes) {
      if (character !== '"') {
        field += character;
      } else if (record[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = false;
        afterQuote = true;
      }
      continue;
    }
    if (afterQuote) {
      if (character !== ",") {
        return null;
      }
      fields.push(field);
      field = "";
      afterQuote = false;
      continue;
    }
    if (character === ",") {
      fields.push(field);
      field = "";
    } else if (character === '"') {
      if (field.length > 0) {
        return null;
      }
      inQuotes = true;
    } else {
      field += character;
    }
  }
  if (inQuotes) {
    return null;
  }
  fields.push(field);
  return fields;
}

function invalidRow(
  record: CsvByteRecord,
  lineNumber: number,
  errorCode: string,
  message: string,
): ParsedImportRow {
  const error: ImportRowError = {
    line_number: lineNumber,
    error_code: errorCode,
    message,
    raw_excerpt: createRawExcerpt(record.contentPrefix),
  };
  return {
    kind: "error",
    lineNumber,
    startByte: record.startByte,
    checkpointBytes: record.checkpointBytes,
    error,
  };
}

function createBatch(rows: ParsedImportRow[]): ImportBatch {
  const last = rows[rows.length - 1];
  if (!last) {
    throw new Error("Cannot create an empty CSV batch.");
  }
  return {
    rows,
    processedBytes: last.checkpointBytes,
    lastLineNumber: last.lineNumber,
  };
}

function decodeRecord(record: CsvByteRecord, message: string): string {
  try {
    return fatalUtf8Decoder.decode(record.contentPrefix);
  } catch {
    throw new CsvFormatError(message);
  }
}

function createRawExcerpt(bytes: Uint8Array): string {
  const codePoints = Array.from(excerptDecoder.decode(bytes.subarray(0, RAW_EXCERPT_MAX_BYTES)));
  while (Buffer.byteLength(codePoints.join(""), "utf8") > RAW_EXCERPT_MAX_BYTES) {
    codePoints.pop();
  }
  return codePoints.join("");
}

function assertBatchSize(batchSize: number): void {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > CSV_BATCH_SIZE_MAX) {
    throw new RangeError(`batchSize must be an integer between 1 and ${CSV_BATCH_SIZE_MAX}.`);
  }
}
