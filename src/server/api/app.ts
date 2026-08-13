import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "nestjs-pino";

import type { Environment } from "../config/environment.js";
import { ApiModule } from "./api.module.js";

export async function createApiApplication(environment: Environment): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule.forRoot(environment), {
    bufferLogs: true,
    bodyParser: false,
  });

  app.disable("x-powered-by");
  app.useLogger(app.get(Logger));
  app.useBodyParser("json", { limit: environment.API_BODY_LIMIT_BYTES });
  app.useBodyParser("urlencoded", {
    extended: false,
    limit: environment.API_BODY_LIMIT_BYTES,
  });
  app.enableCors({
    origin: environment.DASHBOARD_ORIGIN,
    methods: ["GET", "HEAD", "POST", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Request-ID"],
    exposedHeaders: ["X-Request-ID"],
    credentials: false,
  });

  return app;
}
