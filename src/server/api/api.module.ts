import { type DynamicModule, Module } from "@nestjs/common";

import type { Environment } from "../config/environment.js";
import { EnvironmentModule } from "../config/environment.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { HealthModule } from "../modules/health/health.module.js";
import { StorageModule } from "../storage/storage.module.js";

@Module({})
export class ApiModule {
  static forRoot(environment: Environment): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        EnvironmentModule.forRoot(environment),
        DatabaseModule.forRoot("api"),
        StorageModule,
        HealthModule,
      ],
    };
  }
}
