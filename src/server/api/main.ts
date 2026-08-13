import "reflect-metadata";

import { loadEnvironment } from "../config/environment.js";
import { createApiApplication } from "./app.js";

async function bootstrap(): Promise<void> {
  const environment = loadEnvironment();
  const app = await createApiApplication();

  app.enableShutdownHooks();
  await app.listen(environment.SIFT_API_PORT, "0.0.0.0");
}

void bootstrap();
