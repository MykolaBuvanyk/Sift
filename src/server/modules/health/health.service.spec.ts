import { ServiceUnavailableException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DatabaseService } from "../../database/database.service.js";
import type { StorageService } from "../../storage/storage.service.js";
import { HealthService } from "./health.service.js";

describe("HealthService", () => {
  const database = { ping: vi.fn() };
  const storage = { ping: vi.fn() };
  let health: HealthService;

  beforeEach(() => {
    vi.resetAllMocks();
    health = new HealthService(
      database as unknown as DatabaseService,
      storage as unknown as StorageService,
    );
  });

  it("is unavailable before bootstrap and while draining", async () => {
    await expect(health.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);

    health.onApplicationBootstrap();
    health.beforeApplicationShutdown();

    await expect(health.readiness()).rejects.toMatchObject({ status: 503 });
  });

  it("reports both dependencies when ready", async () => {
    health.onApplicationBootstrap();

    await expect(health.readiness()).resolves.toEqual({
      status: "ok",
      checks: { database: "ok", storage: "ok" },
    });
    expect(database.ping).toHaveBeenCalledOnce();
    expect(storage.ping).toHaveBeenCalledOnce();
  });

  it("returns unavailable when a dependency check fails", async () => {
    database.ping.mockRejectedValueOnce(new Error("database unavailable"));
    health.onApplicationBootstrap();

    await expect(health.readiness()).rejects.toMatchObject({ status: 503 });
  });
});
