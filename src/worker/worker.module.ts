import { type DynamicModule, Module } from "@nestjs/common";

import { EnvironmentModule } from "../server/config/environment.module.js";
import type { Environment } from "../server/config/environment.js";
import { DatabaseModule } from "../server/database/database.module.js";
import { StorageModule } from "../server/storage/storage.module.js";
import { ImportWorkerModule } from "./imports/import-worker.module.js";

@Module({})
export class WorkerModule {
  static forRoot(environment: Environment): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        EnvironmentModule.forRoot(environment),
        DatabaseModule.forRoot("worker"),
        StorageModule,
        ImportWorkerModule,
      ],
    };
  }
}
