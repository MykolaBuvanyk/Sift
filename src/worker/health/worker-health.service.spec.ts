import { randomUUID } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { Environment } from "../../server/config/environment.js";
import { WorkerHealthService } from "./worker-health.service.js";

describe("WorkerHealthService", () => {
  it("writes a private heartbeat and removes readiness while stopping", async () => {
    const heartbeatPath = join(tmpdir(), `sift-worker-health-${randomUUID()}`);
    const service = new WorkerHealthService({
      WORKER_HEALTH_FILE: heartbeatPath,
      WORKER_HEALTH_WRITE_INTERVAL_MS: 1_000,
    } as Environment);

    try {
      await service.markSuccessfulIteration(true);

      expect(Number((await readFile(heartbeatPath, "utf8")).trim())).toBeGreaterThan(0);
      expect((await stat(heartbeatPath)).mode & 0o777).toBe(0o600);

      await service.markStopping();
      await expect(access(heartbeatPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await service.markStopping();
    }
  });
});
