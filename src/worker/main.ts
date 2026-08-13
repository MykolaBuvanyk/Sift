import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { loadEnvironment } from "../server/config/environment.js";
import { WorkerModule } from "./worker.module.js";

async function bootstrap(): Promise<void> {
  const environment = loadEnvironment();
  const context = await NestFactory.createApplicationContext(WorkerModule.forRoot(environment), {
    bufferLogs: true,
  });

  context.enableShutdownHooks();
}

void bootstrap();
