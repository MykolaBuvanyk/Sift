import { Body, Controller, Module, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EnvironmentModule } from "../config/environment.module.js";
import type { Environment } from "../config/environment.js";
import { AuthModule } from "../core/auth/auth.module.js";
import {
  CurrentOwner,
  type AuthenticatedOwner,
} from "../core/auth/current-owner.decorator.js";
import { HttpFoundationModule } from "../core/http/http-foundation.module.js";
import { CreateImportDto } from "../modules/imports/dto/create-import.dto.js";

const environment = {
  NODE_ENV: "test",
  AUTH_BEARER_TOKEN: "test-token-with-at-least-32-characters",
  AUTH_OWNER_ID: "00000000-0000-4000-8000-000000000001",
  LOG_LEVEL: "fatal",
} as Environment;

class TestImportsController {
  create(
    metadata: CreateImportDto,
    owner: AuthenticatedOwner,
  ): { ownerId: string; filename: string } {
    return { ownerId: owner.id, filename: metadata.filename };
  }
}

Controller("test-imports")(TestImportsController);
const createDescriptor = Object.getOwnPropertyDescriptor(
  TestImportsController.prototype,
  "create",
);
if (!createDescriptor) {
  throw new Error("Test controller method descriptor is missing");
}
Post()(TestImportsController.prototype, "create", createDescriptor);
Body()(TestImportsController.prototype, "create", 0);
CurrentOwner()(TestImportsController.prototype, "create", 1);
Reflect.defineMetadata(
  "design:paramtypes",
  [CreateImportDto, Object],
  TestImportsController.prototype,
  "create",
);

class TestApiModule {}

Module({
  imports: [
    EnvironmentModule.forRoot(environment),
    HttpFoundationModule.forRoot(environment),
    AuthModule,
  ],
  controllers: [TestImportsController],
})(TestApiModule);

describe("HTTP foundation", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(TestApiModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns the stable 401 contract without credentials", async () => {
    const response = await fetch(`${baseUrl}/test-imports`, { method: "POST" });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(body).toMatchObject({
      code: "AUTH.UNAUTHORIZED",
      message: "A valid Bearer token is required.",
    });
    expect(body.traceId).toBe(response.headers.get("x-request-id"));
  });

  it("rejects owner spoofing with the stable validation contract", async () => {
    const response = await fetch(`${baseUrl}/test-imports`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${environment.AUTH_BEARER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotency_key: "upload-1",
        format: "ndjson",
        filename: "contacts.ndjson",
        declared_size_bytes: 128,
        ownerId: "00000000-0000-4000-8000-000000000099",
      }),
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(body.code).toBe("VALIDATION.FAILED");
    expect(body.traceId).toBe(response.headers.get("x-request-id"));
  });

  it("uses the server-derived owner for valid metadata", async () => {
    const response = await fetch(`${baseUrl}/test-imports`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${environment.AUTH_BEARER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotency_key: "upload-1",
        format: "ndjson",
        filename: "contacts.ndjson",
        declared_size_bytes: 128,
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      ownerId: environment.AUTH_OWNER_ID,
      filename: "contacts.ndjson",
    });
  });
});
