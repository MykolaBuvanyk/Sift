export type StorageErrorCode =
  | "STORAGE_OBJECT_NOT_FOUND"
  | "STORAGE_TIMEOUT"
  | "STORAGE_UNAVAILABLE";

export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StorageError";
  }
}
