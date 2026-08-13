import { describe, expect, it, vi } from "vitest";

import { AllExceptionsFilter } from "./all-exceptions.filter.js";

describe("AllExceptionsFilter", () => {
  it("logs a sanitized 500 payload without message, stack, or cause", () => {
    const logger = { error: vi.fn() };
    const response = {
      headersSent: false,
      setHeader: vi.fn(),
      status: vi.fn(),
      json: vi.fn(),
    };
    response.status.mockReturnValue(response);
    const request = {
      id: "req_test",
      method: "POST",
      url: "/imports/test/finalize",
      user: { id: "00000000-0000-4000-8000-000000000001" },
    };
    const host = {
      getType: vi.fn().mockReturnValue("http"),
      switchToHttp: vi.fn().mockReturnValue({
        getResponse: () => response,
        getRequest: () => request,
      }),
    };
    const providerError = new Error("provider-secret-message", {
      cause: new Error("nested-provider-secret"),
    });

    new AllExceptionsFilter(logger as never).catch(providerError, host as never);

    const logPayload = logger.error.mock.calls[0]?.[0];
    expect(logPayload).toEqual({
      errorName: "Error",
      code: "INTERNAL.UNEXPECTED",
      method: request.method,
      path: request.url,
      traceId: request.id,
      ownerId: request.user.id,
    });
    expect(JSON.stringify(logPayload)).not.toContain("provider-secret");
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      code: "INTERNAL.UNEXPECTED",
      message: "Something went wrong.",
      traceId: request.id,
    });
  });
});
