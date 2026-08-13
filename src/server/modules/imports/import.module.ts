import { Module } from "@nestjs/common";

import { ImportCleanupService } from "./import-cleanup.service.js";
import { ImportController } from "./import.controller.js";
import { ImportRepository } from "./import.repository.js";
import { ImportService } from "./import.service.js";

@Module({
  controllers: [ImportController],
  providers: [ImportRepository, ImportService, ImportCleanupService],
})
export class ImportModule {}
