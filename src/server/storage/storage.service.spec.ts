import { describe, expect, it } from "vitest";

import type { Environment } from "../config/environment.js";
import { StorageService } from "./storage.service.js";

const environment: Environment = {
  NODE_ENV: "test",
  SIFT_API_PORT: 3_001,
  AUTH_BEARER_TOKEN: "test-token-with-at-least-32-characters",
  AUTH_OWNER_ID: "00000000-0000-4000-8000-000000000001",
  DASHBOARD_ORIGIN: "http://localhost:3000",
  API_BODY_LIMIT_BYTES: 65_536,
  LOG_LEVEL: "info",
  IMPORT_MAX_BYTES: 1_000_000_000,
  IMPORT_RESERVATION_TTL_SECONDS: 3_600,
  IMPORT_FINALIZE_TIMEOUT_MS: 600_000,
  IMPORT_CLEANUP_INTERVAL_SECONDS: 300,
  IMPORT_CLEANUP_CLAIM_SECONDS: 600,
  IMPORT_CLEANUP_BATCH_SIZE: 25,
  IMPORT_MAX_LINE_BYTES: 1_048_576,
  IMPORT_BATCH_SIZE: 500,
  DATABASE_URL: "postgresql://sift:password@127.0.0.1:54322/sift",
  DATABASE_API_POOL_MAX: 10,
  DATABASE_WORKER_POOL_MAX: 5,
  DATABASE_CONNECT_TIMEOUT_MS: 5_000,
  DATABASE_STATEMENT_TIMEOUT_MS: 30_000,
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY: "local-access",
  S3_SECRET_KEY: "local-secret-key",
  S3_BUCKET: "sift-imports",
  S3_REQUEST_TIMEOUT_MS: 3_000,
  S3_PRESIGN_TTL_SECONDS: 300,
  WORKER_POLL_INTERVAL_MS: 1_000,
  WORKER_LEASE_SECONDS: 30,
};

describe("StorageService", () => {
  it("creates an owner-prefixed opaque key without path injection", () => {
    const storage = new StorageService(environment);

    expect(storage.createObjectKey("owner/../other")).toMatch(
      /^owners\/owner%2F\.\.%2Fother\/imports\/[0-9a-f-]{36}$/,
    );
  });

  it("rejects invalid range offsets before contacting storage", async () => {
    const storage = new StorageService(environment);

    await expect(storage.getRangeStream("object-key", -1)).rejects.toBeInstanceOf(RangeError);
  });
});
