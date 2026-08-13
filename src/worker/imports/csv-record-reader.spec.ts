import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { type CsvByteRecord, readCsvRecords } from "./csv-record-reader.js";

describe("readCsvRecords", () => {
  it("keeps quoted newlines inside one record across chunk boundaries", async () => {
    const source = Buffer.from(
      "email,full_name\r\n\"a@example.com\",\"First\nLast\"\r\nb@example.com,Bee\n",
    );
    const records = await collect(Readable.from([
      source.subarray(0, 25),
      source.subarray(25, 38),
      source.subarray(38),
    ]), 1_024);

    expect(records.map((record) => Buffer.from(record.contentPrefix).toString("utf8"))).toEqual([
      "email,full_name",
      '"a@example.com","First\nLast"',
      "b@example.com,Bee",
    ]);
    expect(records.at(-1)?.checkpointBytes).toBe(source.byteLength);
  });

  it("recognizes escaped quote pairs split between chunks", async () => {
    const source = Buffer.from('email,full_name\nquoted@example.com,"A ""quoted"" name"\n');
    const split = source.indexOf('""') + 1;
    const records = await collect(Readable.from([
      source.subarray(0, split),
      source.subarray(split),
    ]), 1_024);

    expect(records).toHaveLength(2);
    expect(Buffer.from(records[1]?.contentPrefix ?? []).toString()).toContain('""quoted""');
  });

  it("bounds retained bytes for an oversized record", async () => {
    const source = Buffer.from(`email,full_name\n${"x".repeat(30)}\n`);
    const records = await collect(Readable.from([source]), 10);

    expect(records[1]).toMatchObject({ tooLong: true, contentByteLength: 30 });
    expect(records[1]?.contentPrefix).toHaveLength(10);
  });
});

async function collect(source: Readable, maxRecordBytes: number) {
  const records: CsvByteRecord[] = [];
  for await (const record of readCsvRecords(source, { maxRecordBytes })) {
    records.push(record);
  }
  return records;
}
