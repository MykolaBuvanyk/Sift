import { type DynamicModule, Module } from "@nestjs/common";

import type { Environment } from "../config/environment.js";
import { EnvironmentModule } from "../config/environment.module.js";
import { AuthModule } from "../core/auth/auth.module.js";
import { HttpFoundationModule } from "../core/http/http-foundation.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { HealthModule } from "../modules/health/health.module.js";
import { ImportModule } from "../modules/imports/import.module.js";
import { StorageModule } from "../storage/storage.module.js";

@Module({})
export class ApiModule {
  static forRoot(environment: Environment): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        EnvironmentModule.forRoot(environment),
        HttpFoundationModule.forRoot(environment),
        AuthModule,
        DatabaseModule.forRoot("api"),
        StorageModule,
        HealthModule,
        ImportModule,
      ],
    };
  }
}
