import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SIFT_API_PORT: z.coerce.number().int().min(1).max(65_535).default(3_001),
  AUTH_BEARER_TOKEN: z.string().min(32),
  AUTH_OWNER_ID: z.uuid(),
  DASHBOARD_ORIGIN: z.url(),
  API_BODY_LIMIT_BYTES: z.coerce.number().int().min(1_024).max(1_048_576).default(65_536),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  IMPORT_MAX_BYTES: z.coerce.number().int().min(1).max(5_000_000_000).default(1_000_000_000),
  IMPORT_RESERVATION_TTL_SECONDS: z.coerce.number().int().min(300).max(604_800).default(3_600),
  IMPORT_FINALIZE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(600_000),
  IMPORT_CLEANUP_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3_600).default(300),
  IMPORT_CLEANUP_CLAIM_SECONDS: z.coerce.number().int().min(30).max(3_600).default(600),
  IMPORT_CLEANUP_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
  IMPORT_MAX_LINE_BYTES: z.coerce.number().int().min(256).max(10_485_760).default(1_048_576),
  IMPORT_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(500),
  DATABASE_URL: z.string().min(1),
  DATABASE_API_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_WORKER_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(5_000),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(30_000),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(8),
  S3_BUCKET: z.string().min(3),
  S3_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(3_000),
  S3_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(30).max(300).default(300),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(5).max(3_600).default(30),
});

export type Environment = z.infer<typeof environmentSchema>;

export function loadEnvironment(): Environment {
  const result = environmentSchema.safeParse(process.env);

  if (!result.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(result.error)}`);
  }

  return Object.freeze(result.data);
}
