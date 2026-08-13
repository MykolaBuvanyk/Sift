import type { Readable } from "node:stream";

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";

import { ENVIRONMENT } from "../../server/config/environment.module.js";
import type { Environment } from "../../server/config/environment.js";
import { StorageService } from "../../server/storage/storage.service.js";
import {
  type CsvHeader,
  parseCsvBatches,
  readCsvHeader,
} from "./csv-parser.js";
import { classifyImportFailure } from "./import-failure-policy.js";
import { ImportInvariantError, ImportLeaseLostError } from "./import-worker.errors.js";
import { ImportWorkerRepository } from "./import-worker.repository.js";
import type { ClaimedImportJob } from "./import-worker.types.js";
import { parseNdjsonBatches } from "./ndjson-parser.js";
import { WorkerHealthService } from "../health/worker-health.service.js";

class WorkerStoppingError extends Error {
  constructor() {
    super("The import worker is stopping.");
    this.name = "WorkerStoppingError";
  }
}

type ProcessOutcome = "continue" | "backoff";

@Injectable()
export class ImportWorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ImportWorkerService.name);
  private activeStream: Readable | null = null;
  private runPromise: Promise<void> | null = null;
  private stopPollingWait: (() => void) | null = null;
  private stopping = false;

  constructor(
    @Inject(ImportWorkerRepository) private readonly imports: ImportWorkerRepository,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(WorkerHealthService) private readonly health: Pick<
      WorkerHealthService,
      "markSuccessfulIteration" | "markStopping"
    >,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.health.markSuccessfulIteration(true);
    this.runPromise = this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.stopPollingWait?.();
    this.activeStream?.destroy(new WorkerStoppingError());
    await this.runPromise;
    await this.health.markStopping();
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      try {
        const job = await this.imports.claimNext(this.environment.WORKER_LEASE_SECONDS);
        if (job) {
          const outcome = await this.process(job);
          if (outcome === "continue") {
            await this.health.markSuccessfulIteration();
            continue;
          }
        } else {
          await this.health.markSuccessfulIteration();
        }
      } catch (error: unknown) {
        this.logger.error({
          message: "Import worker iteration failed.",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }

      await this.waitForNextPoll();
    }
  }

  private async process(claimedJob: ClaimedImportJob): Promise<ProcessOutcome> {
    let job = claimedJob;

    try {
      if (job.processedBytes < job.totalBytes) {
        const csvHeader = job.format === "csv" && job.processedBytes > 0
          ? await this.loadCsvHeader(job)
          : undefined;
        const object = await this.storage.getRangeStream(
          job.sourceObjectPath,
          job.processedBytes,
        );
        this.assertRangeResponse(
          job.totalBytes,
          job.processedBytes,
          object.contentLength,
          object.contentRange,
        );
        this.activeStream = object.stream;

        const batches = job.format === "csv"
          ? parseCsvBatches(object.stream, {
            batchSize: this.environment.IMPORT_BATCH_SIZE,
            header: csvHeader,
            initialByteOffset: job.processedBytes,
            initialLineNumber: job.lastLineNumber,
            maxRecordBytes: this.environment.IMPORT_MAX_LINE_BYTES,
          })
          : parseNdjsonBatches(object.stream, {
            maxLineBytes: this.environment.IMPORT_MAX_LINE_BYTES,
            batchSize: this.environment.IMPORT_BATCH_SIZE,
            initialByteOffset: job.processedBytes,
            initialLineNumber: job.lastLineNumber,
          });

        for await (const batch of batches) {
          const progress = await this.imports.commitBatch({
            job,
            batch,
            leaseSeconds: this.environment.WORKER_LEASE_SECONDS,
          });
          job = {
            ...job,
            processedBytes: progress.processedBytes,
            lastLineNumber: progress.lastLineNumber,
            importedCount: progress.importedCount,
            failedCount: progress.failedCount,
            duplicateCount: progress.duplicateCount,
            leaseExpiresAt: progress.leaseExpiresAt,
          };
          await this.health.markSuccessfulIteration();

          if (this.stopping) {
            await this.imports.release(job.id, job.leaseToken);
            return "continue";
          }
        }
      }

      if (job.processedBytes !== job.totalBytes) {
        throw new ImportInvariantError("The source stream ended before the declared byte size.");
      }
      if (job.lastLineNumber !== job.importedCount + job.failedCount + job.duplicateCount) {
        throw new ImportInvariantError("Import counters do not reconcile with the line checkpoint.");
      }
      if (!await this.imports.complete(job)) {
        throw new ImportLeaseLostError();
      }
      return "continue";
    } catch (error: unknown) {
      if (this.stopping) {
        await this.imports.release(job.id, job.leaseToken);
        return "continue";
      }
      if (error instanceof ImportLeaseLostError) {
        this.logger.warn({ message: "Import lease was lost.", jobId: job.id });
        return "continue";
      }

      const failure = classifyImportFailure(error);
      if (failure.action === "retry") {
        const released = await this.imports.release(job.id, job.leaseToken);
        this.logger.warn({
          message: released
            ? "Import job released after a transient failure."
            : "Import job hit a transient failure after its lease was lost.",
          jobId: job.id,
          failureCode: failure.code,
        });
        return "backoff";
      }
      const markedFailed = await this.imports.fail(
        job.id,
        job.leaseToken,
        failure.code,
        failure.message,
      );
      this.logger.error({
        message: markedFailed
          ? "Import job failed."
          : "Import job failed after its lease was lost.",
        jobId: job.id,
        failureCode: failure.code,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return "continue";
    } finally {
      this.activeStream?.destroy();
      this.activeStream = null;
    }
  }

  private async loadCsvHeader(job: ClaimedImportJob): Promise<CsvHeader> {
    const object = await this.storage.getRangeStream(job.sourceObjectPath, 0);
    this.assertRangeResponse(job.totalBytes, 0, object.contentLength, object.contentRange);
    this.activeStream = object.stream;
    try {
      return await readCsvHeader(object.stream, this.environment.IMPORT_MAX_LINE_BYTES);
    } finally {
      object.stream.destroy();
      if (this.activeStream === object.stream) {
        this.activeStream = null;
      }
    }
  }

  private assertRangeResponse(
    totalBytes: number,
    startByte: number,
    contentLength: number,
    contentRange?: string,
  ): void {
    const expectedLength = totalBytes - startByte;
    if (contentLength !== expectedLength) {
      throw new ImportInvariantError("Object range size does not match the import checkpoint.");
    }
    if (startByte === 0 && contentRange === undefined) {
      return;
    }

    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange ?? "");
    if (
      !match
      || Number(match[1]) !== startByte
      || Number(match[2]) !== totalBytes - 1
      || Number(match[3]) !== totalBytes
    ) {
      throw new ImportInvariantError("Object storage returned an unexpected byte range.");
    }
  }

  private waitForNextPoll(): Promise<void> {
    if (this.stopping) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const finish = (): void => {
        clearTimeout(timeout);
        if (this.stopPollingWait === finish) {
          this.stopPollingWait = null;
        }
        resolve();
      };
      const timeout = setTimeout(finish, this.environment.WORKER_POLL_INTERVAL_MS);
      this.stopPollingWait = finish;
    });
  }
}
