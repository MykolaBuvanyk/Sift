import { describe, expect, it } from "vitest";

import { partitionImportBatch } from "./import-batch.js";
import type { ParsedNdjsonRow } from "./ndjson-parser.types.js";

describe("partitionImportBatch", () => {
  it("keeps the first contact value and preserves every duplicate row for counting", () => {
    const rows: ParsedNdjsonRow[] = [
      validRow(1, "same@example.com", "First"),
      validRow(2, "same@example.com", "Second"),
    ];

    const partitioned = partitionImportBatch(rows);

    expect(partitioned.validRows).toHaveLength(2);
    expect(partitioned.firstContactByEmail.get("same@example.com")?.full_name).toBe("First");
  });
});

function validRow(lineNumber: number, email: string, fullName: string): ParsedNdjsonRow {
  return {
    kind: "valid",
    lineNumber,
    startByte: lineNumber - 1,
    checkpointBytes: lineNumber,
    contact: { email, full_name: fullName, tags: [] },
  };
}
