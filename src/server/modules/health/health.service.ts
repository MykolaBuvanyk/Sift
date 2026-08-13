import {
  BeforeApplicationShutdown,
  Injectable,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from "@nestjs/common";

import { DatabaseService } from "../../database/database.service.js";
import { StorageService } from "../../storage/storage.service.js";

export interface ReadinessResult {
  readonly status: "ok";
  readonly checks: {
    readonly database: "ok";
    readonly storage: "ok";
  };
}

@Injectable()
export class HealthService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private acceptingTraffic = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
  ) {}

  onApplicationBootstrap(): void {
    this.acceptingTraffic = true;
  }

  beforeApplicationShutdown(): void {
    this.acceptingTraffic = false;
  }

  async readiness(): Promise<ReadinessResult> {
    if (!this.acceptingTraffic) {
      throw new ServiceUnavailableException({
        status: "unavailable",
        reason: "draining",
      });
    }

    try {
      await Promise.all([this.database.ping(), this.storage.ping()]);
    } catch {
      throw new ServiceUnavailableException({
        status: "unavailable",
        reason: "dependency_check_failed",
      });
    }

    return {
      status: "ok",
      checks: { database: "ok", storage: "ok" },
    };
  }
}
