import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { z } from "zod";

const migrationEnvironmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(5_000),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(30_000),
  MIGRATIONS_PATH: z.string().min(1).default("drizzle/migrations"),
});

async function runMigrations(): Promise<void> {
  const environment = migrationEnvironmentSchema.parse(process.env);
  const pool = new Pool({
    connectionString: environment.DATABASE_URL,
    connectionTimeoutMillis: environment.DATABASE_CONNECT_TIMEOUT_MS,
    max: 1,
    statement_timeout: environment.DATABASE_STATEMENT_TIMEOUT_MS,
  });

  try {
    await migrate(drizzle(pool), { migrationsFolder: environment.MIGRATIONS_PATH });
  } finally {
    await pool.end();
  }
}

await runMigrations();
