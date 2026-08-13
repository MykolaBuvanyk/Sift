import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { loadEnvironment } from "../server/config/environment.js";
import { WorkerModule } from "./worker.module.js";

async function bootstrap(): Promise<void> {
  loadEnvironment();
  const context = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });

  context.enableShutdownHooks();
}

void bootstrap();
