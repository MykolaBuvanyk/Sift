import { describe, expect, it } from "vitest";

import { contactSchema } from "./index.js";

describe("contactSchema", () => {
  it("accepts a valid contact and rejects an invalid email", () => {
    expect(contactSchema.safeParse({
      email: "person@example.com",
      full_name: "Test Person",
      tags: ["customer"],
    }).success).toBe(true);

    expect(contactSchema.safeParse({
      email: "invalid",
      full_name: "Test Person",
      tags: [],
    }).success).toBe(false);
  });
});
