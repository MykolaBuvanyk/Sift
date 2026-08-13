import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { readByteLines } from "./byte-line-reader.js";

describe("readByteLines", () => {
  it("preserves UTF-8 rows and byte checkpoints across arbitrary chunks", async () => {
    const bytes = Buffer.from("один\r\nдва\nтри", "utf8");
    const source = Readable.from([
      bytes.subarray(0, 3),
      bytes.subarray(3, 9),
      bytes.subarray(9),
    ]);

    const lines = [];
    for await (const line of readByteLines(source, { maxLineBytes: 100 })) {
      lines.push({
        text: Buffer.from(line.contentPrefix).toString("utf8"),
        lineNumber: line.lineNumber,
        checkpointBytes: line.checkpointBytes,
        delimiterBytes: line.delimiterBytes,
      });
    }

    expect(lines).toEqual([
      { text: "один", lineNumber: 1, checkpointBytes: 10, delimiterBytes: 2 },
      { text: "два", lineNumber: 2, checkpointBytes: 17, delimiterBytes: 1 },
      { text: "три", lineNumber: 3, checkpointBytes: bytes.byteLength, delimiterBytes: 0 },
    ]);
  });

  it("retains only a bounded prefix for an oversized row", async () => {
    const source = Readable.from([Buffer.from("123456789\nnext\n")]);
    const lines = [];

    for await (const line of readByteLines(source, { maxLineBytes: 4 })) {
      lines.push(line);
    }

    expect(lines[0]).toMatchObject({
      contentByteLength: 9,
      checkpointBytes: 10,
      tooLong: true,
    });
    expect(Buffer.from(lines[0]?.contentPrefix ?? []).toString()).toBe("1234");
    expect(Buffer.from(lines[1]?.contentPrefix ?? []).toString()).toBe("next");
  });

  it("continues absolute offsets and line numbers for a range stream", async () => {
    const [line] = await collect(readByteLines(Readable.from([Buffer.from("row\n")]), {
      maxLineBytes: 100,
      initialByteOffset: 200,
      initialLineNumber: 12,
    }));

    expect(line).toMatchObject({ lineNumber: 13, startByte: 200, checkpointBytes: 204 });
  });
});

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) {
    values.push(value);
  }
  return values;
}
