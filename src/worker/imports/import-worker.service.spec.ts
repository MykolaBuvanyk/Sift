import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { Environment } from "../../server/config/environment.js";
import type { StorageService } from "../../server/storage/storage.service.js";
import { ImportWorkerService } from "./import-worker.service.js";
import type { ImportWorkerRepository } from "./import-worker.repository.js";
import type { ClaimedImportJob } from "./import-worker.types.js";
import { readCsvRecords } from "./csv-record-reader.js";

describe("ImportWorkerService CSV resume", () => {
  it("re-reads a bounded header then resumes data from the committed byte checkpoint", async () => {
    const source = Buffer.from([
      "full_name,email",
      "First,first@example.com",
      "Second,second@example.com",
      "",
    ].join("\n"));
    const records = [];
    for await (const record of readCsvRecords(Readable.from([source]), {
      maxRecordBytes: 1_024,
    })) {
      records.push(record);
    }
    const checkpoint = records[1]?.checkpointBytes ?? 0;
    const job = claimedCsvJob(source.byteLength, checkpoint);
    const imports = {
      claimNext: vi.fn().mockResolvedValueOnce(job).mockResolvedValue(null),
      commitBatch: vi.fn().mockResolvedValue({
        processedBytes: source.byteLength,
        lastLineNumber: 2,
        importedCount: 2,
        failedCount: 0,
        duplicateCount: 0,
        leaseExpiresAt: new Date(Date.now() + 30_000),
        replayed: false,
      }),
      complete: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(true),
      fail: vi.fn().mockResolvedValue(true),
    };
    const storage = {
      getRangeStream: vi.fn(async (_key: string, startByte: number) => ({
        stream: Readable.from([source.subarray(startByte)]),
        contentLength: source.byteLength - startByte,
        contentRange: `bytes ${startByte}-${source.byteLength - 1}/${source.byteLength}`,
      })),
    };
    const worker = new ImportWorkerService(
      imports as unknown as ImportWorkerRepository,
      storage as unknown as StorageService,
      environment(),
    );

    worker.onModuleInit();
    await vi.waitFor(() => expect(imports.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        id: job.id,
        processedBytes: source.byteLength,
        lastLineNumber: 2,
        importedCount: 2,
        failedCount: 0,
        duplicateCount: 0,
      }),
    ));
    await worker.onApplicationShutdown();

    expect(storage.getRangeStream).toHaveBeenNthCalledWith(1, job.sourceObjectPath, 0);
    expect(storage.getRangeStream).toHaveBeenNthCalledWith(2, job.sourceObjectPath, checkpoint);
    expect(imports.commitBatch).toHaveBeenCalledTimes(1);
    expect(imports.fail).not.toHaveBeenCalled();
  });
});

function claimedCsvJob(totalBytes: number, processedBytes: number): ClaimedImportJob {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    ownerId: "00000000-0000-4000-8000-000000000001",
    sourceObjectPath: "owners/test/imports/csv-resume",
    format: "csv",
    totalBytes,
    processedBytes,
    lastLineNumber: 1,
    importedCount: 1,
    failedCount: 0,
    duplicateCount: 0,
    leaseToken: "00000000-0000-4000-8000-000000000020",
    leaseExpiresAt: new Date(Date.now() + 30_000),
  };
}

function environment(): Environment {
  return {
    IMPORT_BATCH_SIZE: 10,
    IMPORT_MAX_LINE_BYTES: 1_024,
    WORKER_LEASE_SECONDS: 30,
    WORKER_POLL_INTERVAL_MS: 100,
  } as Environment;
}
