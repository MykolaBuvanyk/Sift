import { describe, expect, it } from "vitest";

import { StorageError } from "../../server/storage/storage.error.js";
import { classifyImportFailure } from "./import-failure-policy.js";
import { ImportInvariantError } from "./import-worker.errors.js";

describe("classifyImportFailure", () => {
  it("retries transient storage failures without exposing provider details", () => {
    expect(classifyImportFailure(new StorageError("STORAGE_TIMEOUT", "secret provider detail")))
      .toEqual({
        action: "retry",
        code: "IMPORT.STORAGE_UNAVAILABLE",
        message: "Object storage is temporarily unavailable.",
      });
  });

  it("fails missing sources and data-integrity violations permanently", () => {
    expect(classifyImportFailure(new StorageError("STORAGE_OBJECT_NOT_FOUND", "missing")))
      .toMatchObject({ action: "fail", code: "IMPORT.SOURCE_MISSING" });
    expect(classifyImportFailure(new ImportInvariantError("internal detail")))
      .toMatchObject({ action: "fail", code: "IMPORT.DATA_INTEGRITY_FAILURE" });
  });
});
