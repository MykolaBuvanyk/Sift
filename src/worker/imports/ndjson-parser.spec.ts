import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { parseNdjsonBatches } from "./ndjson-parser.js";

describe("parseNdjsonBatches", () => {
  it("normalizes valid contacts, reports bad rows, and continues parsing", async () => {
    const source = Readable.from([
      Buffer.from('{"email":" Person@Example.COM ","full_name":"Person","tags":[]}\n{"bad":'),
      Buffer.from('true}\nnot-json\n{"email":"next@example.com","full_name":"Next","tags":[]}'),
    ]);
    const batches = [];

    for await (const batch of parseNdjsonBatches(source, {
      maxLineBytes: 1_024,
      batchSize: 2,
    })) {
      batches.push(batch);
    }

    expect(batches).toHaveLength(2);
    expect(batches.flatMap((batch) => batch.rows).map((row) => row.kind)).toEqual([
      "valid",
      "error",
      "error",
      "valid",
    ]);
    expect(batches[0]?.rows[0]).toMatchObject({
      kind: "valid",
      contact: { email: "person@example.com" },
    });
    expect(batches[0]?.rows[1]).toMatchObject({
      kind: "error",
      error: { error_code: "IMPORT_ROW.INVALID_CONTACT" },
    });
    expect(batches[1]?.rows[0]).toMatchObject({
      kind: "error",
      error: { error_code: "IMPORT_ROW.INVALID_JSON" },
    });
  });

  it("bounds batches and raw excerpts", async () => {
    const invalid = Buffer.from(`${"💥".repeat(300)}\n`);
    const [batch] = await collect(parseNdjsonBatches(Readable.from([invalid]), {
      maxLineBytes: 2_000,
      batchSize: 1,
    }));
    const row = batch?.rows[0];

    expect(row?.kind).toBe("error");
    if (row?.kind === "error") {
      expect(Buffer.byteLength(row.error.raw_excerpt, "utf8")).toBeLessThanOrEqual(500);
      expect(Array.from(row.error.raw_excerpt)).toHaveLength(125);
    }
  });
});

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) {
    values.push(value);
  }
  return values;
}
