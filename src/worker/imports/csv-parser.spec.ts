import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  CsvFormatError,
  parseCsvBatches,
  readCsvHeader,
} from "./csv-parser.js";
import { readCsvRecords } from "./csv-record-reader.js";
import type { ImportBatch } from "./ndjson-parser.types.js";

describe("CSV parser", () => {
  it("parses reordered columns, quoted commas, newlines, escaped quotes and tags", async () => {
    const source = Buffer.from([
      "full_name,email,tags,phone",
      '"Doe, Jane",JANE@EXAMPLE.COM,"vip|lead",',
      '"First\n""Nickname"" Last",second@example.com,"[""new"",""uk""]",+380501234567',
      "",
    ].join("\r\n"));
    const batches = await collect(source, { batchSize: 10, maxRecordBytes: 2_048 });

    expect(batches).toHaveLength(1);
    expect(batches[0]?.rows).toEqual([
      expect.objectContaining({
        kind: "valid",
        lineNumber: 1,
        contact: {
          email: "jane@example.com",
          full_name: "Doe, Jane",
          tags: ["vip", "lead"],
        },
      }),
      expect.objectContaining({
        kind: "valid",
        lineNumber: 2,
        contact: {
          email: "second@example.com",
          full_name: 'First\n"Nickname" Last',
          phone: "+380501234567",
          tags: ["new", "uk"],
        },
      }),
    ]);
    expect(batches[0]?.processedBytes).toBe(source.byteLength);
  });

  it("continues after invalid contacts, column counts and row quoting", async () => {
    const source = Buffer.from([
      "email,full_name,phone,tags",
      "not-an-email,Bad,,",
      "short@example.com",
      '"quoted@example.com"x,Bad,,',
      "valid@example.com,Valid,,vip",
      "",
    ].join("\n"));
    const [batch] = await collect(source, { batchSize: 10, maxRecordBytes: 2_048 });

    expect(batch?.rows.map((row) => row.kind)).toEqual(["error", "error", "error", "valid"]);
    expect(batch?.rows.slice(0, 3).map((row) => row.kind === "error" && row.error.error_code))
      .toEqual([
        "IMPORT_ROW.INVALID_CONTACT",
        "IMPORT_ROW.CSV_COLUMN_COUNT",
        "IMPORT_ROW.INVALID_CSV",
      ]);
  });

  it("classifies invalid UTF-8 and oversized rows with bounded excerpts", async () => {
    const header = Buffer.from("email,full_name\n");
    const invalidUtf8 = Buffer.from([0xff, 0x2c, 0x42, 0x61, 0x64, 0x0a]);
    const oversized = Buffer.from(`${"x".repeat(700)},Name\n`);
    const [batch] = await collect(Buffer.concat([header, invalidUtf8, oversized]), {
      batchSize: 10,
      maxRecordBytes: 600,
    });

    expect(batch?.rows.map((row) => row.kind === "error" && row.error.error_code)).toEqual([
      "IMPORT_ROW.INVALID_UTF8",
      "IMPORT_ROW.RECORD_TOO_LONG",
    ]);
    const second = batch?.rows[1];
    expect(second?.kind === "error" ? Buffer.byteLength(second.error.raw_excerpt) : 0)
      .toBeLessThanOrEqual(500);
  });

  it("resumes at an absolute byte checkpoint using a separately parsed header", async () => {
    const source = Buffer.from([
      "full_name,email",
      "First,first@example.com",
      "Second,second@example.com",
      "",
    ].join("\n"));
    const records = [];
    for await (const record of readCsvRecords(Readable.from([source]), {
      maxRecordBytes: 1_024,
    })) {
      records.push(record);
    }
    const firstDataCheckpoint = records[1]?.checkpointBytes ?? 0;
    const header = await readCsvHeader(Readable.from([source]), 1_024);
    const batches = await collect(source.subarray(firstDataCheckpoint), {
      batchSize: 10,
      header,
      initialByteOffset: firstDataCheckpoint,
      initialLineNumber: 1,
      maxRecordBytes: 1_024,
    });

    expect(batches[0]).toMatchObject({
      processedBytes: source.byteLength,
      lastLineNumber: 2,
      rows: [expect.objectContaining({ lineNumber: 2, kind: "valid" })],
    });
  });

  it("rejects invalid, duplicate and header-only CSV files", async () => {
    await expect(collect(Buffer.from("email,email\na@b.com,a@b.com\n"), {
      batchSize: 10,
      maxRecordBytes: 1_024,
    })).rejects.toBeInstanceOf(CsvFormatError);
    await expect(collect(Buffer.from("email,unknown\na@b.com,x\n"), {
      batchSize: 10,
      maxRecordBytes: 1_024,
    })).rejects.toBeInstanceOf(CsvFormatError);
    await expect(collect(Buffer.from("email,full_name\n"), {
      batchSize: 10,
      maxRecordBytes: 1_024,
    })).rejects.toBeInstanceOf(CsvFormatError);
  });
});

type Options = Parameters<typeof parseCsvBatches>[1];

async function collect(source: Buffer, options: Options) {
  const batches: ImportBatch[] = [];
  for await (const batch of parseCsvBatches(Readable.from([source]), options)) {
    batches.push(batch);
  }
  return batches;
}
