import { importJobSchema } from "@sift/contracts";
import { z } from "zod";

import { invalidRequest, proxyJson } from "../../_lib/sift-api-proxy";

const idSchema = z.uuid();

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const parsed = idSchema.safeParse((await context.params).id);
  if (!parsed.success) {
    return invalidRequest("A valid import ID is required.");
  }
  return proxyJson(`/imports/${parsed.data}`, {
    method: "GET",
    request,
    responseSchema: importJobSchema,
  });
}
