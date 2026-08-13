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

function createService(deleteFailure = false) {
  const repository = {
    claimExpiredForCleanup: vi.fn().mockResolvedValue([cleanupReservation]),
    completeCleanup: vi.fn().mockResolvedValue(true),
    releaseCleanupClaim: vi.fn().mockResolvedValue(undefined),
  };
  const storage = {
    deleteObject: deleteFailure
      ? vi.fn().mockRejectedValue(new Error("storage unavailable"))
      : vi.fn().mockResolvedValue(undefined),
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
    const { service, repository } = createService(true);

    await service.cleanupExpiredReservations();

    expect(repository.completeCleanup).not.toHaveBeenCalled();
    expect(repository.releaseCleanupClaim).toHaveBeenCalledWith(
      cleanupReservation.id,
      cleanupReservation.cleanupToken,
    );
  });
});
