import { Module } from "@nestjs/common";

import { ImportCleanupService } from "./import-cleanup.service.js";
import { ImportController } from "./import.controller.js";
import { ImportErrorReportRepository } from "./import-error-report.repository.js";
import { ImportErrorReportService } from "./import-error-report.service.js";
import { ImportRepository } from "./import.repository.js";
import { ImportService } from "./import.service.js";

@Module({
  controllers: [ImportController],
  providers: [
    ImportRepository,
    ImportService,
    ImportCleanupService,
    ImportErrorReportRepository,
    ImportErrorReportService,
  ],
})
export class ImportModule {}
