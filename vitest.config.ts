import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration files share the same PostgreSQL queue and assert global SKIP LOCKED ordering.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
    include: ["src/**/*.spec.ts", "tests/**/*.spec.ts"],
  },
});
