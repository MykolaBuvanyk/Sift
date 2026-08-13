import { type DynamicModule, Global, Module } from "@nestjs/common";

import type { Environment } from "./environment.js";

export const ENVIRONMENT = Symbol("ENVIRONMENT");

@Global()
@Module({})
export class EnvironmentModule {
  static forRoot(environment: Environment): DynamicModule {
    return {
      module: EnvironmentModule,
      providers: [{ provide: ENVIRONMENT, useValue: environment }],
      exports: [ENVIRONMENT],
    };
  }
}
