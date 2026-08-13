import { afterEach, describe, expect, it, vi } from "vitest";

import { createImport, SiftApiError, uploadImportSource } from "./sift-api-client";

const metadata = {
  idempotency_key: "00000000-0000-4000-8000-000000000001",
  format: "ndjson" as const,
  filename: "contacts.ndjson",
  declared_size_bytes: 128,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Sift dashboard API client", () => {
  it("validates successful API responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      job_id: "00000000-0000-4000-8000-000000000010",
      status: "pending",
      upload_required: true,
      upload_url: "http://localhost:9000/upload",
      upload_method: "PUT",
      upload_headers: { "Content-Type": "application/x-ndjson" },
      upload_url_expires_at: "2026-08-13T10:05:00.000Z",
      reservation_expires_at: "2026-08-13T11:00:00.000Z",
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createImport(metadata)).resolves.toMatchObject({ status: "pending" });
    expect(fetchMock).toHaveBeenCalledWith("/api/imports", expect.objectContaining({
      method: "POST",
      cache: "no-store",
    }));
  });

  it("preserves stable API error codes and trace IDs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "IMPORT.IDEMPOTENCY_CONFLICT",
      message: "The idempotency key was already used with different metadata.",
      traceId: "req_123",
    }), { status: 409, headers: { "Content-Type": "application/json" } })));

    const request = createImport(metadata);
    await expect(request).rejects.toMatchObject({
      code: "IMPORT.IDEMPOTENCY_CONFLICT",
      traceId: "req_123",
    });
    await expect(request).rejects.toBeInstanceOf(SiftApiError);
  });

  it("rejects malformed successful responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(createImport(metadata)).rejects.toMatchObject({
      code: "DASHBOARD.INVALID_RESPONSE",
    });
  });

  it("continues finalize recovery when the conditional object already exists", async () => {
    const progress = vi.fn();
    vi.stubGlobal("XMLHttpRequest", ConditionalUploadRequest);

    await expect(uploadImportSource({
      job_id: "00000000-0000-4000-8000-000000000010",
      status: "pending",
      upload_required: true,
      upload_url: "http://localhost:9000/upload",
      upload_method: "PUT",
      upload_headers: { "If-None-Match": "*" },
      upload_url_expires_at: "2026-08-13T10:05:00.000Z",
      reservation_expires_at: "2026-08-13T11:00:00.000Z",
    }, { name: "contacts.ndjson" } as File, progress)).resolves.toBeUndefined();
    expect(progress).toHaveBeenLastCalledWith(100);
  });
});

class ConditionalUploadRequest extends EventTarget {
  readonly upload = new EventTarget();
  status = 412;

  open(): void {}
  setRequestHeader(): void {}
  abort(): void {
    this.dispatchEvent(new Event("abort"));
  }
  send(): void {
    this.dispatchEvent(new Event("load"));
  }
}
