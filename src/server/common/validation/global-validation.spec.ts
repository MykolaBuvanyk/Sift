import { type ArgumentMetadata, ValidationPipe } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { CreateImportDto } from "../../modules/imports/dto/create-import.dto.js";

const metadata: ArgumentMetadata = {
  type: "body",
  metatype: CreateImportDto,
  data: undefined,
};

function createPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
  });
}

describe("global validation policy", () => {
  it("accepts valid import metadata", async () => {
    const result = await createPipe().transform({
      idempotency_key: "upload-2026-08-13",
      format: "ndjson",
      filename: "contacts.ndjson",
      declared_size_bytes: 1_024,
    }, metadata);

    expect(result).toBeInstanceOf(CreateImportDto);
  });

  it("rejects a client-supplied ownerId", async () => {
    await expect(createPipe().transform({
      idempotency_key: "upload-2026-08-13",
      format: "ndjson",
      filename: "contacts.ndjson",
      declared_size_bytes: 1_024,
      ownerId: "00000000-0000-4000-8000-000000000099",
    }, metadata)).rejects.toMatchObject({ status: 400 });
  });
});
