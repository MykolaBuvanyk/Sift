import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Environment } from "../src/server/config/environment.js";
import { DatabaseService } from "../src/server/database/database.service.js";
import { contacts, importJobs, importRowErrors } from "../src/server/database/schema.js";
import { parseCsvBatches, readCsvHeader } from "../src/worker/imports/csv-parser.js";
import { ImportWorkerRepository } from "../src/worker/imports/import-worker.repository.js";
import type { ClaimedImportJob } from "../src/worker/imports/import-worker.types.js";
import type { ImportBatch } from "../src/worker/imports/ndjson-parser.types.js";
import { parseNdjsonBatches } from "../src/worker/imports/ndjson-parser.js";

const databaseUrl = process.env.DATABASE_URL;
const acceptance = describe.skipIf(!databaseUrl);

acceptance("import pipeline acceptance", () => {
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

  it("resumes a mixed CSV after a simulated crash without duplicate counters", async () => {
    const source = Buffer.from([
      "full_name,email,tags",
      "First,first@example.com,vip",
      "Broken,not-an-email,",
      "Duplicate,first@example.com,",
      "Second,second@example.com,lead|uk",
      "wrong-column-count@example.com",
      "",
    ].join("\n"));
    const id = await seedJob("csv", source.byteLength, "csv-crash-resume", new Date("1990-01-01"));
    const claimed = await repository.claimNext(5);
    expect(claimed).toMatchObject({ id, format: "csv" });

    const parser = parseCsvBatches(Readable.from([source]), {
      batchSize: 2,
      maxRecordBytes: 2_048,
    });
    const first = await parser.next();
    expect(first.done).toBe(false);
    const committed = await repository.commitBatch({
      job: claimed as ClaimedImportJob,
      batch: first.value as ImportBatch,
      leaseSeconds: 5,
    });
    await parser.return(undefined);

    const reclaimed = await repository.claimNext(
      30,
      new Date(committed.leaseExpiresAt.getTime() + 1),
    );
    expect(reclaimed).toMatchObject({ id, processedBytes: committed.processedBytes });

    const header = await readCsvHeader(Readable.from([source]), 2_048);
    const resumed = parseCsvBatches(Readable.from([source.subarray(committed.processedBytes)]), {
      batchSize: 2,
      header,
      initialByteOffset: committed.processedBytes,
      initialLineNumber: committed.lastLineNumber,
      maxRecordBytes: 2_048,
    });
    const finalJob = await commitAll(reclaimed as ClaimedImportJob, resumed);
    await expect(repository.complete(finalJob)).resolves.toBe(true);

    const [stored] = await database.client.select().from(importJobs).where(eq(importJobs.id, id));
    expect(stored).toMatchObject({
      status: "completed",
      processedBytes: source.byteLength,
      lastLineNumber: 5,
      importedCount: 2,
      failedCount: 2,
      duplicateCount: 1,
    });
    const storedContacts = await database.client.select().from(contacts).where(eq(contacts.ownerId, ownerId));
    expect(storedContacts.map((contact) => contact.email).sort()).toEqual([
      "first@example.com",
      "second@example.com",
    ]);
    const errors = await database.client.select().from(importRowErrors).where(eq(importRowErrors.jobId, id));
    expect(errors.map((error) => error.lineNumber)).toEqual([2, 5]);
  });

  it("processes a generated 5k-row NDJSON source in bounded atomic batches", async () => {
    const source = generateNdjson(5_000);
    const id = await seedJob("ndjson", source.byteLength, "large-ndjson", new Date("1991-01-01"));
    const claimed = await repository.claimNext(30);
    expect(claimed?.id).toBe(id);

    const batches = parseNdjsonBatches(Readable.from([source]), {
      batchSize: 500,
      maxLineBytes: 2_048,
    });
    const finalJob = await commitAll(claimed as ClaimedImportJob, batches);
    await expect(repository.complete(finalJob)).resolves.toBe(true);

    const [stored] = await database.client.select().from(importJobs).where(and(
      eq(importJobs.id, id),
      eq(importJobs.ownerId, ownerId),
    ));
    expect(stored).toMatchObject({
      status: "completed",
      lastLineNumber: 5_000,
      importedCount: 4_950,
      failedCount: 50,
      duplicateCount: 0,
    });
  }, 30_000);

  async function seedJob(
    format: "csv" | "ndjson",
    totalBytes: number,
    idempotencyKey: string,
    createdAt: Date,
  ): Promise<string> {
    const id = randomUUID();
    await database.client.insert(importJobs).values({
      id,
      ownerId,
      idempotencyKey,
      originalName: `contacts.${format}`,
      contentHash: "a".repeat(64),
      sourceObjectPath: `owners/${ownerId}/imports/${id}`,
      format,
      status: "pending",
      totalBytes,
      uploadedAt: new Date(),
      reservationExpiresAt: new Date(Date.now() + 60_000),
      createdAt,
    });
    return id;
  }

  async function commitAll(
    initialJob: ClaimedImportJob,
    batches: AsyncIterable<ImportBatch>,
  ): Promise<ClaimedImportJob> {
    let job = initialJob;
    for await (const batch of batches) {
      const progress = await repository.commitBatch({ job, batch, leaseSeconds: 30 });
      job = { ...job, ...progress };
    }
    return job;
  }
});

function generateNdjson(rows: number): Buffer {
  const chunks: string[] = [];
  for (let line = 1; line <= rows; line += 1) {
    chunks.push(line % 100 === 0
      ? "not-json\n"
      : `${JSON.stringify({
        email: `generated-${line}@example.com`,
        full_name: `Generated ${line}`,
        tags: ["acceptance"],
      })}\n`);
  }
  return Buffer.from(chunks.join(""));
}
