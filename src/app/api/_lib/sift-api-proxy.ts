import "server-only";

import { apiErrorSchema } from "@sift/contracts";
import type { ZodType } from "zod";

const DEFAULT_API_URL = "http://127.0.0.1:3001";

type ProxyJsonOptions<T> = {
  body?: unknown;
  method: "GET" | "POST";
  request?: Request;
  responseSchema: ZodType<T>;
};

type UpstreamResult = {
  local: boolean;
  response: Response;
};

export async function proxyJson<T>(
  path: string,
  options: ProxyJsonOptions<T>,
): Promise<Response> {
  const result = await fetchUpstream(path, {
    method: options.method,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    signal: options.request?.signal,
  });
  if (result.local) {
    return result.response;
  }
  const upstream = result.response;

  const payload: unknown = await upstream.json().catch(() => null);
  const schema = upstream.ok ? options.responseSchema : apiErrorSchema;
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return dashboardError(502, "DASHBOARD.INVALID_UPSTREAM_RESPONSE", "The API returned an invalid response.");
  }

  return Response.json(parsed.data, {
    status: upstream.status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function proxyErrorReport(path: string, request: Request): Promise<Response> {
  const result = await fetchUpstream(path, {
    method: "GET",
    signal: request.signal,
  });
  if (result.local) {
    return result.response;
  }
  const upstream = result.response;
  if (!upstream.ok) {
    const payload: unknown = await upstream.json().catch(() => null);
    const parsed = apiErrorSchema.safeParse(payload);
    if (!parsed.success) {
      return dashboardError(502, "DASHBOARD.INVALID_UPSTREAM_RESPONSE", "The API returned an invalid response.");
    }
    return Response.json(parsed.data, { status: upstream.status });
  }

  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": upstream.headers.get("content-type") ?? "application/x-ndjson; charset=utf-8",
  });
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) {
    headers.set("Content-Disposition", disposition);
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}

export function invalidRequest(message = "The request is invalid."): Response {
  return dashboardError(400, "REQUEST.VALIDATION_FAILED", message);
}

async function fetchUpstream(path: string, init: RequestInit): Promise<UpstreamResult> {
  const token = process.env.AUTH_BEARER_TOKEN;
  if (!token) {
    return {
      local: true,
      response: dashboardError(503, "DASHBOARD.NOT_CONFIGURED", "The dashboard API connection is not configured."),
    };
  }

  let url: URL;
  try {
    url = new URL(path, normalizeBaseUrl(process.env.SIFT_API_URL ?? DEFAULT_API_URL));
  } catch {
    return {
      local: true,
      response: dashboardError(503, "DASHBOARD.NOT_CONFIGURED", "The dashboard API connection is not configured."),
    };
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json, application/x-ndjson");

  try {
    return {
      local: false,
      response: await fetch(url, {
        ...init,
        cache: "no-store",
        headers,
      }),
    };
  } catch {
    return {
      local: true,
      response: dashboardError(503, "DASHBOARD.API_UNAVAILABLE", "The API is currently unavailable."),
    };
  }
}

function normalizeBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Unsupported API protocol.");
  }
  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  return url;
}

function dashboardError(status: number, code: string, message: string): Response {
  return Response.json({ code, message, traceId: "dashboard" }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
