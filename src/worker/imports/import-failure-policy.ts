import { StorageError } from "../../server/storage/storage.error.js";
import { CsvFormatError } from "./csv-parser.js";
import { ImportInvariantError } from "./import-worker.errors.js";

export interface ImportFailureDisposition {
  readonly action: "fail" | "retry";
  readonly code: string;
  readonly message: string;
}

export function classifyImportFailure(error: unknown): ImportFailureDisposition {
  if (error instanceof CsvFormatError) {
    return {
      action: "fail",
      code: "IMPORT.INVALID_CSV_HEADER",
      message: "The CSV file has an invalid header or no data rows.",
    };
  }
  if (error instanceof StorageError) {
    if (error.code === "STORAGE_OBJECT_NOT_FOUND") {
      return {
        action: "fail",
        code: "IMPORT.SOURCE_MISSING",
        message: "The import source object is missing.",
      };
    }
    return {
      action: "retry",
      code: "IMPORT.STORAGE_UNAVAILABLE",
      message: "Object storage is temporarily unavailable.",
    };
  }
  if (error instanceof ImportInvariantError) {
    return {
      action: "fail",
      code: "IMPORT.DATA_INTEGRITY_FAILURE",
      message: "Import data integrity validation failed.",
    };
  }
  return {
    action: "fail",
    code: "IMPORT.WORKER_FAILURE",
    message: "The import worker could not process this job.",
  };
}
