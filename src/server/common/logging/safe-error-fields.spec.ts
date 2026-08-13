import { describe, expect, it } from "vitest";

import { toSafeErrorFields } from "./safe-error-fields.js";

describe("toSafeErrorFields", () => {
  it("keeps only a bounded error class name", () => {
    const providerError = new Error("provider-secret-message", {
      cause: new Error("nested-provider-secret"),
    });

    const fields = toSafeErrorFields(providerError);

    expect(fields).toEqual({ errorName: "Error" });
    expect(JSON.stringify(fields)).not.toContain("provider-secret");
    expect(fields).not.toHaveProperty("message");
    expect(fields).not.toHaveProperty("stack");
    expect(fields).not.toHaveProperty("cause");
  });

  it("does not trust a custom error name as arbitrary log text", () => {
    const error = new Error("safe message");
    error.name = "Error secret-token";

    expect(toSafeErrorFields(error)).toEqual({ errorName: "Error" });
    expect(toSafeErrorFields("not-an-error")).toEqual({ errorName: "UnknownError" });
  });
});
