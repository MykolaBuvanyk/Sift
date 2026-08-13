import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { ApiModule } from "./api.module.js";

export function createApiApplication(): Promise<NestExpressApplication> {
  return NestFactory.create<NestExpressApplication>(ApiModule, {
    bufferLogs: true,
  });
}
