import { Module } from "@nestjs/common";

import { ImportWorkerRepository } from "./import-worker.repository.js";
import { ImportWorkerService } from "./import-worker.service.js";
import { WorkerHealthService } from "../health/worker-health.service.js";

@Module({
  providers: [ImportWorkerRepository, WorkerHealthService, ImportWorkerService],
})
export class ImportWorkerModule {}
