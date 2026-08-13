import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle/migrations",
  schema: "./src/server/database/schema.ts",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://sift:sift-local-password@127.0.0.1:54322/sift",
  },
});
