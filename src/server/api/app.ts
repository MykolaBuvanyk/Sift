import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import type { Environment } from "../config/environment.js";
import { ApiModule } from "./api.module.js";

export function createApiApplication(environment: Environment): Promise<NestExpressApplication> {
  return NestFactory.create<NestExpressApplication>(ApiModule.forRoot(environment), {
    bufferLogs: true,
  });
}
