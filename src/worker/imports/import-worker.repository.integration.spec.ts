import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Environment } from "../../server/config/environment.js";
import { DatabaseService } from "../../server/database/database.service.js";
import { contacts, importJobs } from "../../server/database/schema.js";
import { ImportLeaseLostError } from "./import-worker.errors.js";
import { ImportWorkerRepository } from "./import-worker.repository.js";
import type { ClaimedImportJob } from "./import-worker.types.js";
import type { NdjsonBatch } from "./ndjson-parser.types.js";

const databaseUrl = process.env.DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("ImportWorkerRepository integration", () => {
  const ownerId = randomUUID();
  let database: DatabaseService;
  let repository: ImportWorkerRepository;

  beforeAll(async () => {
    database = new DatabaseService({
      DATABASE_URL: databaseUrl,
      DATABASE_WORKER_POOL_MAX: 4,
      DATABASE_CONNECT_TIMEOUT_MS: 5_000,
      DATABASE_STATEMENT_TIMEOUT_MS: 30_000,
    } as Environment, "worker");
    await database.onModuleInit();
    repository = new ImportWorkerRepository(database);
  });

  afterAll(async () => {
    await database.client.delete(contacts).where(eq(contacts.ownerId, ownerId));
    await database.client.delete(importJobs).where(eq(importJobs.ownerId, ownerId));
    await database.onApplicationShutdown();
  });

  it("claims different jobs concurrently with SKIP LOCKED", async () => {
    const ids = [randomUUID(), randomUUID()];
    await database.client.insert(importJobs).values(ids.map((id, index) => jobRow({
      id,
      ownerId,
      idempotencyKey: `claim-${index}`,
      format: index === 0 ? "ndjson" : "csv",
    })));

    const claimed = await Promise.all([
      repository.claimNext(30),
      repository.claimNext(30),
    ]);

    expect(new Set(claimed.map((job) => job?.id))).toEqual(new Set(ids));
    expect(new Set(claimed.map((job) => job?.format))).toEqual(new Set(["ndjson", "csv"]));
    await Promise.all(claimed.map((job) => (
      job ? repository.release(job.id, job.leaseToken) : Promise.resolve(false)
    )));
    await database.client.delete(importJobs).where(inArray(importJobs.id, ids));
  });

  it("fences a stale worker after lease takeover", async () => {
    const id = randomUUID();
    const claimedAt = new Date();
    await database.client.insert(importJobs).values(jobRow({
      id,
      ownerId,
      idempotencyKey: "lease-takeover",
      createdAt: new Date(claimedAt.getTime() - 60_000),
    }));

    const stale = await repository.claimNext(5, claimedAt);
    const active = await repository.claimNext(5, new Date(claimedAt.getTime() + 6_000));

    expect(stale?.id).toBe(id);
    expect(active?.id).toBe(id);
    expect(active?.leaseToken).not.toBe(stale?.leaseToken);
    await expect(repository.commitBatch({
      job: stale as ClaimedImportJob,
      batch: oneInvalidRowBatch(),
      leaseSeconds: 5,
    })).rejects.toBeInstanceOf(ImportLeaseLostError);
    await repository.release((active as ClaimedImportJob).id, (active as ClaimedImportJob).leaseToken);
    await database.client.delete(importJobs).where(eq(importJobs.id, id));
  });

  it("atomically classifies a batch and makes checkpoint replay idempotent", async () => {
    const id = randomUUID();
    await database.client.insert(contacts).values({
      ownerId,
      email: "existing@example.com",
      fullName: "Existing",
      tags: [],
    });
    await database.client.insert(importJobs).values(jobRow({
      id,
      ownerId,
      idempotencyKey: "atomic-batch",
      totalBytes: 40,
      createdAt: new Date(Date.now() - 120_000),
    }));
    const claimed = await repository.claimNext(30);
    expect(claimed?.id).toBe(id);

    const batch = mixedBatch();
    const committed = await repository.commitBatch({
      job: claimed as ClaimedImportJob,
      batch,
      leaseSeconds: 30,
    });
    const replayed = await repository.commitBatch({
      job: claimed as ClaimedImportJob,
      batch,
      leaseSeconds: 30,
    });

    expect(committed).toMatchObject({
      processedBytes: 40,
      lastLineNumber: 4,
      importedCount: 1,
      failedCount: 1,
      duplicateCount: 2,
      replayed: false,
    });
    expect(replayed).toMatchObject({
      importedCount: 1,
      failedCount: 1,
      duplicateCount: 2,
      replayed: true,
    });

    const completedJob: ClaimedImportJob = {
      ...(claimed as ClaimedImportJob),
      ...committed,
    };
    await expect(repository.complete(completedJob)).resolves.toBe(true);

    const [stored] = await database.client
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.id, id), eq(importJobs.ownerId, ownerId)));
    expect(stored).toMatchObject({
      status: "completed",
      importedCount: 1,
      failedCount: 1,
      duplicateCount: 2,
      processedBytes: 40,
      lastLineNumber: 4,
    });
  });
});

function jobRow(overrides: Record<string, unknown>) {
  return {
    id: randomUUID(),
    ownerId: randomUUID(),
    idempotencyKey: randomUUID(),
    originalName: "contacts.ndjson",
    contentHash: "a".repeat(64),
    sourceObjectPath: `owners/test/imports/${randomUUID()}`,
    format: "ndjson" as const,
    status: "pending" as const,
    totalBytes: 10,
    uploadedAt: new Date(),
    reservationExpiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

function oneInvalidRowBatch(): NdjsonBatch {
  return {
    processedBytes: 10,
    lastLineNumber: 1,
    rows: [{
      kind: "error",
      lineNumber: 1,
      startByte: 0,
      checkpointBytes: 10,
      error: {
        line_number: 1,
        error_code: "IMPORT_ROW.INVALID_JSON",
        message: "Invalid JSON.",
        raw_excerpt: "bad",
      },
    }],
  };
}

function mixedBatch(): NdjsonBatch {
  return {
    processedBytes: 40,
    lastLineNumber: 4,
    rows: [
      validRow(1, 10, "existing@example.com", "Existing"),
      validRow(2, 20, "new@example.com", "First value wins"),
      validRow(3, 30, "new@example.com", "Duplicate"),
      {
        kind: "error",
        lineNumber: 4,
        startByte: 30,
        checkpointBytes: 40,
        error: {
          line_number: 4,
          error_code: "IMPORT_ROW.INVALID_JSON",
          message: "Invalid JSON.",
          raw_excerpt: "bad",
        },
      },
    ],
  };
}

function validRow(lineNumber: number, checkpointBytes: number, email: string, fullName: string) {
  return {
    kind: "valid" as const,
    lineNumber,
    startByte: checkpointBytes - 10,
    checkpointBytes,
    contact: { email, full_name: fullName, tags: [] },
  };
}
