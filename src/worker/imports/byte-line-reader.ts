import type { Readable } from "node:stream";

const LF = 0x0a;
const CR = 0x0d;

export type ImportByteStream = Readable | ReadableStream<Uint8Array>;

export interface ByteLineReaderOptions {
  readonly maxLineBytes: number;
  readonly initialByteOffset?: number;
  readonly initialLineNumber?: number;
}

export interface ByteLine {
  /** Complete content for a bounded line, or a bounded prefix for an oversized line. */
  readonly contentPrefix: Uint8Array;
  readonly contentByteLength: number;
  readonly lineNumber: number;
  readonly startByte: number;
  /** Absolute byte offset immediately after LF/CRLF, or at EOF for the final line. */
  readonly checkpointBytes: number;
  readonly delimiterBytes: 0 | 1 | 2;
  readonly tooLong: boolean;
}

interface PendingLine {
  readonly fragments: Buffer[];
  bufferedBytes: number;
  byteLength: number;
  lastByte: number | null;
  startByte: number;
}

export async function* readByteLines(
  source: ImportByteStream,
  options: ByteLineReaderOptions,
): AsyncGenerator<ByteLine> {
  assertNonNegativeInteger(options.initialByteOffset ?? 0, "initialByteOffset");
  assertNonNegativeInteger(options.initialLineNumber ?? 0, "initialLineNumber");
  assertPositiveInteger(options.maxLineBytes, "maxLineBytes");

  const initialByteOffset = options.initialByteOffset ?? 0;
  let absoluteOffset = initialByteOffset;
  let lineNumber = options.initialLineNumber ?? 0;
  let pending = createPendingLine(initialByteOffset);

  for await (const unknownChunk of source as AsyncIterable<unknown>) {
    const chunk = toBytes(unknownChunk);
    let position = 0;

    while (position < chunk.byteLength) {
      const newlineIndex = chunk.indexOf(LF, position);
      const segmentEnd = newlineIndex === -1 ? chunk.byteLength : newlineIndex;
      const segment = chunk.subarray(position, segmentEnd);

      appendSegment(pending, segment, options.maxLineBytes + 1);
      absoluteOffset += segment.byteLength;

      if (newlineIndex === -1) {
        break;
      }

      absoluteOffset += 1;
      lineNumber += 1;
      yield finishLine(
        pending,
        lineNumber,
        absoluteOffset,
        options.maxLineBytes,
        true,
      );
      pending = createPendingLine(absoluteOffset);
      position = newlineIndex + 1;
    }
  }

  if (pending.byteLength > 0) {
    lineNumber += 1;
    yield finishLine(
      pending,
      lineNumber,
      absoluteOffset,
      options.maxLineBytes,
      false,
    );
  }
}

function createPendingLine(startByte: number): PendingLine {
  return {
    fragments: [],
    bufferedBytes: 0,
    byteLength: 0,
    lastByte: null,
    startByte,
  };
}

function appendSegment(pending: PendingLine, segment: Uint8Array, bufferLimit: number): void {
  pending.byteLength += segment.byteLength;
  if (segment.byteLength > 0) {
    pending.lastByte = segment[segment.byteLength - 1] ?? null;
  }

  const remainingCapacity = bufferLimit - pending.bufferedBytes;
  if (remainingCapacity <= 0 || segment.byteLength === 0) {
    return;
  }

  const retained = segment.subarray(0, Math.min(remainingCapacity, segment.byteLength));
  pending.fragments.push(Buffer.from(retained));
  pending.bufferedBytes += retained.byteLength;
}

function finishLine(
  pending: PendingLine,
  lineNumber: number,
  checkpointBytes: number,
  maxLineBytes: number,
  terminatedByNewline: boolean,
): ByteLine {
  const hasCarriageReturn = terminatedByNewline
    && pending.byteLength > 0
    && pending.lastByte === CR;
  const delimiterBytes: 0 | 1 | 2 = terminatedByNewline
    ? (hasCarriageReturn ? 2 : 1)
    : 0;
  const contentByteLength = pending.byteLength - (hasCarriageReturn ? 1 : 0);
  const tooLong = contentByteLength > maxLineBytes;
  const retained = Buffer.concat(pending.fragments, pending.bufferedBytes);
  const retainedContentBytes = tooLong
    ? Math.min(maxLineBytes, retained.byteLength)
    : contentByteLength;

  return {
    contentPrefix: retained.subarray(0, retainedContentBytes),
    contentByteLength,
    lineNumber,
    startByte: pending.startByte,
    checkpointBytes,
    delimiterBytes,
    tooLong,
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
