import { Module } from "@nestjs/common";

import { ImportWorkerRepository } from "./import-worker.repository.js";
import { ImportWorkerService } from "./import-worker.service.js";

@Module({
  providers: [ImportWorkerRepository, ImportWorkerService],
})
export class ImportWorkerModule {}
