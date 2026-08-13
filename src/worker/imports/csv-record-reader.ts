import type { ImportByteStream } from "./byte-line-reader.js";

const CR = 0x0d;
const LF = 0x0a;
const QUOTE = 0x22;

export interface CsvRecordReaderOptions {
  readonly initialByteOffset?: number;
  readonly maxRecordBytes: number;
}

export interface CsvByteRecord {
  readonly checkpointBytes: number;
  readonly contentByteLength: number;
  readonly contentPrefix: Uint8Array;
  readonly startByte: number;
  readonly tooLong: boolean;
}

interface PendingRecord {
  readonly fragments: Buffer[];
  bufferedBytes: number;
  byteLength: number;
  lastByte: number | null;
  startByte: number;
}

export async function* readCsvRecords(
  source: ImportByteStream,
  options: CsvRecordReaderOptions,
): AsyncGenerator<CsvByteRecord> {
  assertPositiveInteger(options.maxRecordBytes, "maxRecordBytes");
  assertNonNegativeInteger(options.initialByteOffset ?? 0, "initialByteOffset");

  let absoluteOffset = options.initialByteOffset ?? 0;
  let inQuotes = false;
  let pending = createPendingRecord(absoluteOffset);

  for await (const unknownChunk of source as AsyncIterable<unknown>) {
    const chunk = toBytes(unknownChunk);
    let segmentStart = 0;

    for (let index = 0; index < chunk.byteLength; index += 1) {
      const byte = chunk[index];
      absoluteOffset += 1;
      if (byte === QUOTE) {
        inQuotes = !inQuotes;
      }
      if (byte !== LF || inQuotes) {
        continue;
      }

      appendSegment(pending, chunk.subarray(segmentStart, index), options.maxRecordBytes);
      yield finishRecord(pending, absoluteOffset, options.maxRecordBytes, true);
      pending = createPendingRecord(absoluteOffset);
      segmentStart = index + 1;
      inQuotes = false;
    }

    appendSegment(pending, chunk.subarray(segmentStart), options.maxRecordBytes);
  }

  if (pending.byteLength > 0) {
    yield finishRecord(pending, absoluteOffset, options.maxRecordBytes, false);
  }
}

function createPendingRecord(startByte: number): PendingRecord {
  return {
    fragments: [],
    bufferedBytes: 0,
    byteLength: 0,
    lastByte: null,
    startByte,
  };
}

function appendSegment(pending: PendingRecord, segment: Uint8Array, limit: number): void {
  pending.byteLength += segment.byteLength;
  if (segment.byteLength > 0) {
    pending.lastByte = segment[segment.byteLength - 1] ?? null;
  }

  const capacity = limit - pending.bufferedBytes;
  if (capacity <= 0 || segment.byteLength === 0) {
    return;
  }
  const retained = segment.subarray(0, Math.min(capacity, segment.byteLength));
  pending.fragments.push(Buffer.from(retained));
  pending.bufferedBytes += retained.byteLength;
}

function finishRecord(
  pending: PendingRecord,
  checkpointBytes: number,
  maxRecordBytes: number,
  terminatedByLf: boolean,
): CsvByteRecord {
  const hasCarriageReturn = terminatedByLf && pending.lastByte === CR;
  const contentByteLength = pending.byteLength - (hasCarriageReturn ? 1 : 0);
  const content = Buffer.concat(pending.fragments, pending.bufferedBytes);
  const retainedLength = Math.min(contentByteLength, maxRecordBytes, content.byteLength);

  return {
    checkpointBytes,
    contentByteLength,
    contentPrefix: content.subarray(0, retainedLength),
    startByte: pending.startByte,
    tooLong: contentByteLength > maxRecordBytes,
  };
}

function toBytes(chunk: unknown): Uint8Array {
  if (!(chunk instanceof Uint8Array)) {
    throw new TypeError("Import byte stream must yield Uint8Array chunks.");
  }
  return chunk;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
}
