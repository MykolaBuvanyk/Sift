import {
  apiErrorSchema,
  createImportRequestSchema,
  createImportResponseSchema,
  finalizeImportResponseSchema,
  importJobSchema,
  retryImportResponseSchema,
} from "@sift/contracts";
import type {
  ApiError,
  CreateImportRequest,
  CreateImportResponse,
  FinalizeImportResponse,
  ImportJob,
  RetryImportResponse,
} from "@sift/contracts";
import type { ZodType } from "zod";

export class SiftApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly traceId?: string,
  ) {
    super(message);
    this.name = "SiftApiError";
  }
}

export async function createImport(
  input: CreateImportRequest,
  signal?: AbortSignal,
): Promise<CreateImportResponse> {
  const metadata = createImportRequestSchema.parse(input);
  return requestJson("/api/imports", createImportResponseSchema, {
    method: "POST",
    body: JSON.stringify(metadata),
    headers: { "Content-Type": "application/json" },
    signal,
  });
}

export function finalizeImport(id: string, signal?: AbortSignal): Promise<FinalizeImportResponse> {
  return requestJson(`/api/imports/${encodeURIComponent(id)}/finalize`, finalizeImportResponseSchema, {
    method: "POST",
    signal,
  });
}

export function getImport(id: string, signal?: AbortSignal): Promise<ImportJob> {
  return requestJson(`/api/imports/${encodeURIComponent(id)}`, importJobSchema, {
    method: "GET",
    signal,
  });
}

export function retryImport(id: string, signal?: AbortSignal): Promise<RetryImportResponse> {
  return requestJson(`/api/imports/${encodeURIComponent(id)}/retry`, retryImportResponseSchema, {
    method: "POST",
    signal,
  });
}

export function uploadImportSource(
  response: CreateImportResponse,
  file: File,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.upload_required) {
    onProgress(100);
    return Promise.resolve();
  }
  if (!response.upload_url || response.upload_method !== "PUT") {
    return Promise.reject(new SiftApiError(
      "DASHBOARD.INVALID_UPLOAD_CONTRACT",
      "The API did not provide a valid upload contract.",
    ));
  }

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = (): void => request.abort();
    const cleanup = (): void => signal?.removeEventListener("abort", abort);

    request.open("PUT", response.upload_url as string);
    for (const [name, value] of Object.entries(response.upload_headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    });
    request.addEventListener("load", () => {
      cleanup();
      if ((request.status >= 200 && request.status < 300) || request.status === 412) {
        onProgress(100);
        resolve();
        return;
      }
      reject(new SiftApiError("UPLOAD.FAILED", "The source file upload failed."));
    });
    request.addEventListener("error", () => {
      cleanup();
      reject(new SiftApiError("UPLOAD.UNAVAILABLE", "The object storage is unavailable."));
    });
    request.addEventListener("abort", () => {
      cleanup();
      reject(new SiftApiError("UPLOAD.CANCELLED", "The source file upload was cancelled."));
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    request.send(file);
  });
}

async function requestJson<T>(
  path: string,
  schema: ZodType<T>,
  init: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, cache: "no-store" });
  } catch {
    throw new SiftApiError("DASHBOARD.NETWORK_ERROR", "The dashboard could not reach the API.");
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw toApiError(payload);
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new SiftApiError(
      "DASHBOARD.INVALID_RESPONSE",
      "The dashboard received an invalid API response.",
    );
  }
  return parsed.data;
}

function toApiError(payload: unknown): SiftApiError {
  const parsed = apiErrorSchema.safeParse(payload);
  if (!parsed.success) {
    return new SiftApiError("DASHBOARD.INVALID_ERROR_RESPONSE", "The API request failed.");
  }
  return fromContractError(parsed.data);
}

function fromContractError(error: ApiError): SiftApiError {
  return new SiftApiError(error.code, error.message, error.traceId);
}
