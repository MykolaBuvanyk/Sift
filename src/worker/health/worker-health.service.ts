import { unlink, writeFile } from "node:fs/promises";

import { Inject, Injectable } from "@nestjs/common";

import { ENVIRONMENT } from "../../server/config/environment.module.js";
import type { Environment } from "../../server/config/environment.js";

@Injectable()
export class WorkerHealthService {
  private readonly heartbeatPath: string;
  private readonly minimumWriteIntervalMs: number;
  private lastWrittenAt = 0;
  private stopping = false;

  constructor(@Inject(ENVIRONMENT) environment: Environment) {
    this.heartbeatPath = environment.WORKER_HEALTH_FILE;
    this.minimumWriteIntervalMs = environment.WORKER_HEALTH_WRITE_INTERVAL_MS;
  }

  async markSuccessfulIteration(force = false): Promise<void> {
    if (this.stopping) {
      return;
    }

    const now = Date.now();
    if (!force && now - this.lastWrittenAt < this.minimumWriteIntervalMs) {
      return;
    }

    await writeFile(this.heartbeatPath, `${now}\n`, { encoding: "utf8", mode: 0o600 });
    this.lastWrittenAt = now;
  }

  async markStopping(): Promise<void> {
    this.stopping = true;
    await unlink(this.heartbeatPath).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    });
  }
}
