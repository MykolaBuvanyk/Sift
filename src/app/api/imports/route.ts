import { createImportRequestSchema, createImportResponseSchema } from "@sift/contracts";

import { invalidRequest, proxyJson } from "../_lib/sift-api-proxy";

export async function POST(request: Request): Promise<Response> {
  const payload: unknown = await request.json().catch(() => null);
  const parsed = createImportRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return invalidRequest("Valid import metadata is required.");
  }

  return proxyJson("/imports", {
    method: "POST",
    body: parsed.data,
    request,
    responseSchema: createImportResponseSchema,
  });
}
