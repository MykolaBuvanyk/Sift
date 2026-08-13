import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { ENVIRONMENT } from "../../config/environment.module.js";
import type { Environment } from "../../config/environment.js";
import { StorageService } from "../../storage/storage.service.js";
import { ImportRepository } from "./import.repository.js";
import type { CleanupReservation } from "./import.types.js";

@Injectable()
export class ImportCleanupService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(ImportRepository) private readonly imports: ImportRepository,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @InjectPinoLogger(ImportCleanupService.name) private readonly logger: PinoLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(
      () => void this.cleanupExpiredReservations(),
      this.environment.IMPORT_CLEANUP_INTERVAL_SECONDS * 1_000,
    );
    this.timer.unref();
    void this.cleanupExpiredReservations();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async cleanupExpiredReservations(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const reservations = await this.imports.claimExpiredForCleanup(
        this.environment.IMPORT_CLEANUP_BATCH_SIZE,
        this.environment.IMPORT_CLEANUP_CLAIM_SECONDS,
      );
      for (const reservation of reservations) {
        await this.cleanupOne(reservation);
      }
    } catch (error: unknown) {
      this.logger.error({ err: error }, "import reservation cleanup batch failed");
    } finally {
      this.running = false;
    }
  }

  private async cleanupOne(reservation: CleanupReservation): Promise<void> {
    try {
      await this.storage.deleteObject(reservation.sourceObjectPath);
      const deleted = await this.imports.completeCleanup(
        reservation.id,
        reservation.cleanupToken,
      );
      if (deleted) {
        this.logger.info({ importId: reservation.id }, "expired import reservation removed");
      }
    } catch (error: unknown) {
      await this.imports.releaseCleanupClaim(reservation.id, reservation.cleanupToken);
      this.logger.warn(
        { err: error, importId: reservation.id },
        "expired import reservation cleanup will be retried",
      );
    }
  }
}
