import { describe, expect, it, vi } from "vitest";

import type { Environment } from "../../config/environment.js";
import type { StorageService } from "../../storage/storage.service.js";
import { ImportCleanupService } from "./import-cleanup.service.js";
import type { ImportRepository } from "./import.repository.js";

const cleanupReservation = {
  id: "00000000-0000-4000-8000-000000000010",
  sourceObjectPath: "owners/owner/imports/object",
  cleanupToken: "00000000-0000-4000-8000-000000000020",
};

function createService(deleteFailure?: unknown) {
  const repository = {
    claimExpiredForCleanup: vi.fn().mockResolvedValue([cleanupReservation]),
    completeCleanup: vi.fn().mockResolvedValue(true),
    releaseCleanupClaim: vi.fn().mockResolvedValue(undefined),
  };
  const storage = {
    deleteObject: deleteFailure === undefined
      ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockRejectedValue(deleteFailure),
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const environment = {
    IMPORT_CLEANUP_BATCH_SIZE: 25,
    IMPORT_CLEANUP_CLAIM_SECONDS: 600,
  } as Environment;

  return {
    logger,
    repository,
    storage,
    service: new ImportCleanupService(
      repository as unknown as ImportRepository,
      storage as unknown as StorageService,
      environment,
      logger as never,
    ),
  };
}

describe("ImportCleanupService", () => {
  it("deletes the object before removing the expired reservation", async () => {
    const { service, repository, storage } = createService();

    await service.cleanupExpiredReservations();

    expect(storage.deleteObject).toHaveBeenCalledWith(cleanupReservation.sourceObjectPath);
    expect(repository.completeCleanup).toHaveBeenCalledWith(
      cleanupReservation.id,
      cleanupReservation.cleanupToken,
    );
  });

  it("releases the cleanup claim when object deletion fails", async () => {
    const providerError = new Error("provider-secret-message", {
      cause: new Error("nested-provider-secret"),
    });
    const { service, repository, logger } = createService(providerError);

    await service.cleanupExpiredReservations();

    expect(repository.completeCleanup).not.toHaveBeenCalled();
    expect(repository.releaseCleanupClaim).toHaveBeenCalledWith(
      cleanupReservation.id,
      cleanupReservation.cleanupToken,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { errorName: "Error", importId: cleanupReservation.id },
      "expired import reservation cleanup will be retried",
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("provider-secret");
  });
});
