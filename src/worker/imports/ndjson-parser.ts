import {
  contactSchema,
  type Contact,
  type ImportRowError,
} from "@sift/contracts";

import {
  type ByteLine,
  type ImportByteStream,
  readByteLines,
} from "./byte-line-reader.js";
import {
  IMPORT_ROW_ERROR_CODES,
  type NdjsonBatch,
  type NdjsonParserOptions,
  type ParsedNdjsonRow,
} from "./ndjson-parser.types.js";

const RAW_EXCERPT_MAX_BYTES = 500;
export const NDJSON_BATCH_SIZE_MAX = 1_000;

const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const excerptDecoder = new TextDecoder("utf-8");

export async function* parseNdjsonBatches(
  source: ImportByteStream,
  options: NdjsonParserOptions,
): AsyncGenerator<NdjsonBatch> {
  assertBatchSize(options.batchSize);

  let rows: ParsedNdjsonRow[] = [];

  for await (const line of readByteLines(source, options)) {
    rows.push(parseLine(line));

    if (rows.length === options.batchSize) {
      yield createBatch(rows);
      rows = [];
    }
  }

  if (rows.length > 0) {
    yield createBatch(rows);
  }
}

function parseLine(line: ByteLine): ParsedNdjsonRow {
  if (line.tooLong) {
    return invalidRow(
      line,
      IMPORT_ROW_ERROR_CODES.lineTooLong,
      "The NDJSON row exceeds the configured byte limit.",
    );
  }

  let text: string;
  try {
    text = fatalUtf8Decoder.decode(line.contentPrefix);
  } catch {
    return invalidRow(
      line,
      IMPORT_ROW_ERROR_CODES.invalidUtf8,
      "The NDJSON row is not valid UTF-8.",
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    return invalidRow(
      line,
      IMPORT_ROW_ERROR_CODES.invalidJson,
      "The NDJSON row is not valid JSON.",
    );
  }

  const contact = parseContact(json);
  if (!contact) {
    return invalidRow(
      line,
      IMPORT_ROW_ERROR_CODES.invalidContact,
      "The NDJSON row does not match the contact schema.",
    );
  }

  return {
    kind: "valid",
    lineNumber: line.lineNumber,
    startByte: line.startByte,
    checkpointBytes: line.checkpointBytes,
    contact,
  };
}

function parseContact(value: unknown): Contact | null {
  const normalized = isRecord(value) && typeof value.email === "string"
    ? { ...value, email: value.email.trim().toLowerCase() }
    : value;
  const result = contactSchema.safeParse(normalized);
  return result.success ? result.data : null;
}

function invalidRow(
  line: ByteLine,
  errorCode: string,
  message: string,
): ParsedNdjsonRow {
  const error: ImportRowError = {
    line_number: line.lineNumber,
    error_code: errorCode,
    message,
    raw_excerpt: createRawExcerpt(line.contentPrefix),
  };

  return {
    kind: "error",
    lineNumber: line.lineNumber,
    startByte: line.startByte,
    checkpointBytes: line.checkpointBytes,
    error,
  };
}

function createBatch(rows: ParsedNdjsonRow[]): NdjsonBatch {
  const last = rows[rows.length - 1];
  if (!last) {
    throw new Error("Cannot create an empty NDJSON batch.");
  }

  return {
    rows,
    processedBytes: last.checkpointBytes,
    lastLineNumber: last.lineNumber,
  };
}

function createRawExcerpt(bytes: Uint8Array): string {
  const codePoints = Array.from(
    excerptDecoder.decode(bytes.subarray(0, RAW_EXCERPT_MAX_BYTES)),
  );

  while (
    codePoints.length > RAW_EXCERPT_MAX_BYTES
    || Buffer.byteLength(codePoints.join(""), "utf8") > RAW_EXCERPT_MAX_BYTES
  ) {
    codePoints.pop();
  }

  return codePoints.join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertBatchSize(batchSize: number): void {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > NDJSON_BATCH_SIZE_MAX) {
    throw new RangeError(`batchSize must be an integer between 1 and ${NDJSON_BATCH_SIZE_MAX}.`);
  }
}
