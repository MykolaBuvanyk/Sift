import { describe, expect, it } from "vitest";

import {
  formatBytes,
  inferImportFormat,
  isTerminalStatus,
  validateImportFile,
} from "./import-dashboard.model";

describe("import dashboard model", () => {
  it("infers supported formats without trusting casing", () => {
    expect(inferImportFormat("contacts.CSV")).toBe("csv");
    expect(inferImportFormat("contacts.ndjson")).toBe("ndjson");
    expect(inferImportFormat("contacts.jsonl")).toBe("ndjson");
  });

  it("performs bounded client-side file prevalidation", () => {
    expect(validateImportFile(file("contacts.ndjson", 128))).toBeNull();
    expect(validateImportFile(file("contacts.txt", 128))).toContain(".ndjson");
    expect(validateImportFile(file("contacts.csv", 128))).toBeNull();
    expect(validateImportFile(file("contacts.csv", 0))).toBe("Файл порожній.");
  });

  it("recognizes terminal polling states and formats progress bytes", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("running")).toBe(false);
    expect(formatBytes(1_500_000)).toBe("1.5 MB");
  });
});

function file(name: string, size: number): File {
  return { name, size } as File;
}
