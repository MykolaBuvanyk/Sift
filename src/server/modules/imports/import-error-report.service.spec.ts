import { describe, expect, it, vi } from "vitest";

import { ImportNotFoundError } from "./import.errors.js";
import type { ImportErrorReportRepository } from "./import-error-report.repository.js";
import { ImportErrorReportService } from "./import-error-report.service.js";
import type { ImportRepository } from "./import.repository.js";

const ownerId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000010";

function createService(owned = true) {
  const imports = {
    findOwnedById: vi.fn().mockResolvedValue(owned ? { id: jobId } : null),
  };
  const errorReports = {
    listOwnedBatch: vi.fn(),
  };
  const logger = { error: vi.fn() };

  return {
    imports,
    errorReports,
    service: new ImportErrorReportService(
      imports as unknown as ImportRepository,
      errorReports as unknown as ImportErrorReportRepository,
      logger as never,
    ),
  };
}

describe("ImportErrorReportService", () => {
  it("rejects foreign and missing jobs before opening the stream", async () => {
    const { service, errorReports } = createService(false);

    await expect(service.open(ownerId, jobId)).rejects.toBeInstanceOf(ImportNotFoundError);
    expect(errorReports.listOwnedBatch).not.toHaveBeenCalled();
  });

  it("streams bounded keyset pages as NDJSON in line order", async () => {
    const firstPage = Array.from({ length: 250 }, (_, index) => row(index + 1));
    const { service, errorReports } = createService();
    errorReports.listOwnedBatch
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([row(251)]);

    const report = await service.open(ownerId, jobId);
    const body = await readStream(report.getStream());

    expect(report.getHeaders()).toEqual({
      type: "application/x-ndjson; charset=utf-8",
      disposition: `attachment; filename="import-${jobId}-errors.ndjson"`,
      length: undefined,
    });
    expect(body.trim().split("\n")).toHaveLength(251);
    expect(JSON.parse(body.trim().split("\n")[250] ?? "{}")).toMatchObject({
      line_number: 251,
    });
    expect(errorReports.listOwnedBatch).toHaveBeenNthCalledWith(
      1,
      ownerId,
      jobId,
      0,
      250,
    );
    expect(errorReports.listOwnedBatch).toHaveBeenNthCalledWith(
      2,
      ownerId,
      jobId,
      250,
      250,
    );
  });

  it("stops pagination when the client-side stream is destroyed", async () => {
    const { service, errorReports } = createService();
    errorReports.listOwnedBatch.mockResolvedValue(
      Array.from({ length: 250 }, (_, index) => row(index + 1)),
    );

    const report = await service.open(ownerId, jobId);
    const stream = report.getStream();
    let rowsRead = 0;

    await new Promise<void>((resolve, reject) => {
      stream.on("data", () => {
        rowsRead += 1;
        if (rowsRead === 250) {
          stream.destroy();
        }
      });
      stream.once("close", resolve);
      stream.once("error", reject);
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(errorReports.listOwnedBatch).toHaveBeenCalledTimes(1);
  });
});

function row(lineNumber: number) {
  return {
    line_number: lineNumber,
    error_code: "IMPORT_ROW.INVALID_JSON",
    message: "The NDJSON row is not valid JSON.",
    raw_excerpt: `bad-${lineNumber}`,
  };
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  let output = "";
  for await (const chunk of stream) {
    output += String(chunk);
  }
  return output;
}
