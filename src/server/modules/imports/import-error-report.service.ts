import { Readable } from "node:stream";

import { Inject, Injectable, StreamableFile } from "@nestjs/common";
import type { ImportRowError } from "@sift/contracts";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { ImportNotFoundError } from "./import.errors.js";
import { ImportErrorReportRepository } from "./import-error-report.repository.js";
import { ImportRepository } from "./import.repository.js";

const ERROR_REPORT_BATCH_SIZE = 250;

@Injectable()
export class ImportErrorReportService {
  constructor(
    @Inject(ImportRepository) private readonly imports: ImportRepository,
    @Inject(ImportErrorReportRepository)
    private readonly errorReports: ImportErrorReportRepository,
    @InjectPinoLogger(ImportErrorReportService.name) private readonly logger: PinoLogger,
  ) {}

  async open(ownerId: string, jobId: string): Promise<StreamableFile> {
    if (!await this.imports.findOwnedById(ownerId, jobId)) {
      throw new ImportNotFoundError();
    }

    const stream = Readable.from(this.serialize(ownerId, jobId));
    const report = new StreamableFile(stream, {
      type: "application/x-ndjson; charset=utf-8",
      disposition: `attachment; filename="import-${jobId}-errors.ndjson"`,
    });

    report.setErrorHandler((error, response) => {
      this.logStreamError(error, jobId);
      if (response.destroyed) {
        return;
      }
      if (response.headersSent) {
        response.end();
        return;
      }
      response.statusCode = 503;
      response.end();
    });
    report.setErrorLogger((error) => this.logStreamError(error, jobId));
    return report;
  }

  private async* serialize(ownerId: string, jobId: string): AsyncGenerator<string> {
    let afterLineNumber = 0;

    while (true) {
      const batch = await this.errorReports.listOwnedBatch(
        ownerId,
        jobId,
        afterLineNumber,
        ERROR_REPORT_BATCH_SIZE,
      );
      for (const error of batch) {
        yield serializeError(error);
      }
      if (batch.length < ERROR_REPORT_BATCH_SIZE) {
        return;
      }

      const last = batch[batch.length - 1];
      if (!last) {
        return;
      }
      afterLineNumber = last.line_number;
    }
  }

  private logStreamError(error: Error, jobId: string): void {
    this.logger.error(
      { importId: jobId, errorName: error.name },
      "import error report stream failed",
    );
  }
}

function serializeError(error: ImportRowError): string {
  return `${JSON.stringify(error)}\n`;
}
