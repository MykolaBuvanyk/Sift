import { describe, expect, it } from "vitest";

import type { Environment } from "../../config/environment.js";
import { createPinoHttpOptions } from "./pino-http-options.js";

describe("createPinoHttpOptions", () => {
  it("redacts authorization and common secret fields", () => {
    const options = createPinoHttpOptions({
      NODE_ENV: "test",
      LOG_LEVEL: "info",
    } as Environment);

    expect(options.redact).toMatchObject({
      paths: expect.arrayContaining([
        "req.headers.authorization",
        "req.headers.cookie",
        "**.token",
        "**.secret",
      ]),
      censor: "[REDACTED]",
    });
  });
});
