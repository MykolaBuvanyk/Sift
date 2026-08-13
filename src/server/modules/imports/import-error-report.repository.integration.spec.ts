import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Environment } from "../../config/environment.js";
import { DatabaseService } from "../../database/database.service.js";
import { importJobs, importRowErrors } from "../../database/schema.js";
import { ImportErrorReportRepository } from "./import-error-report.repository.js";

const databaseUrl = process.env.DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("ImportErrorReportRepository integration", () => {
  const ownerId = randomUUID();
  const foreignOwnerId = randomUUID();
  const jobId = randomUUID();
  let database: DatabaseService;
  let repository: ImportErrorReportRepository;

  beforeAll(async () => {
    database = new DatabaseService({
      DATABASE_URL: databaseUrl,
      DATABASE_API_POOL_MAX: 2,
      DATABASE_CONNECT_TIMEOUT_MS: 5_000,
      DATABASE_STATEMENT_TIMEOUT_MS: 30_000,
    } as Environment, "api");
    await database.onModuleInit();
    repository = new ImportErrorReportRepository(database);

    await database.client.insert(importJobs).values({
      id: jobId,
      ownerId,
      idempotencyKey: randomUUID(),
      originalName: "errors.ndjson",
      contentHash: "a".repeat(64),
      sourceObjectPath: `owners/${ownerId}/imports/${randomUUID()}`,
      format: "ndjson",
      status: "failed",
      totalBytes: 30,
      processedBytes: 30,
      lastLineNumber: 3,
      failedCount: 3,
      uploadedAt: new Date(),
      reservationExpiresAt: new Date(Date.now() + 60_000),
      finishedAt: new Date(),
      failureCode: "IMPORT.WORKER_FAILURE",
      failureMessage: "The import worker could not process this job.",
    });
    await database.client.insert(importRowErrors).values([1, 2, 3].map((lineNumber) => ({
      jobId,
      lineNumber,
      errorCode: "IMPORT_ROW.INVALID_JSON",
      message: "The NDJSON row is not valid JSON.",
      rawExcerpt: `bad-${lineNumber}`,
    })));
  });

  afterAll(async () => {
    await database.client.delete(importJobs).where(eq(importJobs.id, jobId));
    await database.onApplicationShutdown();
  });

  it("uses owner-scoped keyset pagination on every batch", async () => {
    await expect(repository.listOwnedBatch(ownerId, jobId, 0, 2)).resolves.toEqual([
      expect.objectContaining({ line_number: 1 }),
      expect.objectContaining({ line_number: 2 }),
    ]);
    await expect(repository.listOwnedBatch(ownerId, jobId, 2, 2)).resolves.toEqual([
      expect.objectContaining({ line_number: 3 }),
    ]);
    await expect(repository.listOwnedBatch(foreignOwnerId, jobId, 0, 2)).resolves.toEqual([]);
  });
});
