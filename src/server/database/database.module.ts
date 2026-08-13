import { type DynamicModule, Global, Module } from "@nestjs/common";

import {
  DATABASE_RUNTIME,
  DatabaseService,
  type DatabaseRuntime,
} from "./database.service.js";

@Global()
@Module({})
export class DatabaseModule {
  static forRoot(runtime: DatabaseRuntime): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        { provide: DATABASE_RUNTIME, useValue: runtime },
        DatabaseService,
      ],
      exports: [DatabaseService],
    };
  }
}
