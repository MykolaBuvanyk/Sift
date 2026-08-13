import {
  ConflictException,
  GatewayTimeoutException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from "@nestjs/common";

export class ImportNotFoundError extends NotFoundException {
  constructor() {
    super({ code: "IMPORT.NOT_FOUND", message: "Import job was not found." });
  }
}

export class ImportMetadataConflictError extends ConflictException {
  constructor() {
    super({
      code: "IMPORT.IDEMPOTENCY_MISMATCH",
      message: "This idempotency key is already associated with different import metadata.",
    });
  }
}

export class ImportRetryNotAllowedError extends ConflictException {
  constructor() {
    super({
      code: "IMPORT.RETRY_NOT_ALLOWED",
      message: "Only a finalized failed import can be retried.",
    });
  }
}

export class ImportReservationExpiredError extends ConflictException {
  constructor() {
    super({ code: "IMPORT.RESERVATION_EXPIRED", message: "The upload reservation has expired." });
  }
}

export class ImportUploadMissingError extends ConflictException {
  constructor() {
    super({ code: "IMPORT.UPLOAD_MISSING", message: "The source object has not been uploaded." });
  }
}

export class ImportUploadMetadataMismatchError extends ConflictException {
  constructor(details: { expectedSize: number; actualSize: number; expectedContentType: string; actualContentType?: string }) {
    super({
      code: "IMPORT.UPLOAD_METADATA_MISMATCH",
      message: "Uploaded object metadata does not match the reservation.",
      details,
    });
  }
}

export class ImportFileTooLargeError extends PayloadTooLargeException {
  constructor(maxBytes: number) {
    super({
      code: "IMPORT.FILE_TOO_LARGE",
      message: "Declared import size exceeds the configured limit.",
      details: { maxBytes },
    });
  }
}

export class ImportFinalizeTimeoutError extends GatewayTimeoutException {
  constructor() {
    super({ code: "IMPORT.FINALIZE_TIMEOUT", message: "Import finalization timed out." });
  }
}

export class ImportStorageUnavailableError extends ServiceUnavailableException {
  constructor(cause?: unknown) {
    super(
      { code: "IMPORT.STORAGE_UNAVAILABLE", message: "Object storage is temporarily unavailable." },
      cause === undefined ? undefined : { cause },
    );
  }
}
