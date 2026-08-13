import { z } from "zod";

import { invalidRequest, proxyErrorReport } from "../../../_lib/sift-api-proxy";

const idSchema = z.uuid();

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const parsed = idSchema.safeParse((await context.params).id);
  if (!parsed.success) {
    return invalidRequest("A valid import ID is required.");
  }
  return proxyErrorReport(`/imports/${parsed.data}/errors`, request);
}
