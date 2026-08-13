import { Readable } from "node:stream";

import { Module, StreamableFile } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { EnvironmentModule } from "../../config/environment.module.js";
import type { Environment } from "../../config/environment.js";
import { AuthModule } from "../../core/auth/auth.module.js";
import { HttpFoundationModule } from "../../core/http/http-foundation.module.js";
import { ImportNotFoundError } from "./import.errors.js";
import { ImportController } from "./import.controller.js";
import { ImportErrorReportService } from "./import-error-report.service.js";
import { ImportService } from "./import.service.js";

const environment = {
  NODE_ENV: "test",
  AUTH_BEARER_TOKEN: "test-token-with-at-least-32-characters",
  AUTH_OWNER_ID: "00000000-0000-4000-8000-000000000001",
  LOG_LEVEL: "fatal",
} as Environment;
const jobId = "00000000-0000-4000-8000-000000000010";
const foreignJobId = "00000000-0000-4000-8000-000000000099";

describe("GET /imports/:id/errors", () => {
  let app: INestApplication;
  let baseUrl: string;
  const errorReports = {
    open: vi.fn(async (ownerId: string, id: string) => {
      if (id === foreignJobId) {
        throw new ImportNotFoundError();
      }
      return new StreamableFile(Readable.from([
        `${JSON.stringify({
          line_number: 2,
          error_code: "IMPORT_ROW.INVALID_JSON",
          message: "The NDJSON row is not valid JSON.",
          raw_excerpt: "bad",
        })}\n`,
      ]), {
        type: "application/x-ndjson; charset=utf-8",
        disposition: `attachment; filename="import-${id}-errors.ndjson"`,
      });
    }),
  };

  beforeAll(async () => {
    class TestModule {}
    Module({
      imports: [
        EnvironmentModule.forRoot(environment),
        HttpFoundationModule.forRoot(environment),
        AuthModule,
      ],
      controllers: [ImportController],
      providers: [
        { provide: ImportService, useValue: {} },
        { provide: ImportErrorReportService, useValue: errorReports },
      ],
    })(TestModule);

    app = await NestFactory.create(TestModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it("streams an authenticated owner report with download headers", async () => {
    const response = await fetch(`${baseUrl}/imports/${jobId}/errors`, {
      headers: { Authorization: `Bearer ${environment.AUTH_BEARER_TOKEN}` },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(response.headers.get("content-disposition"))
      .toBe(`attachment; filename="import-${jobId}-errors.ndjson"`);
    await expect(response.text()).resolves.toContain('"line_number":2');
    expect(errorReports.open).toHaveBeenCalledWith(environment.AUTH_OWNER_ID, jobId);
  });

  it("returns the same 404 contract for a foreign job", async () => {
    const response = await fetch(`${baseUrl}/imports/${foreignJobId}/errors`, {
      headers: { Authorization: `Bearer ${environment.AUTH_BEARER_TOKEN}` },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "IMPORT.NOT_FOUND" });
  });
});
