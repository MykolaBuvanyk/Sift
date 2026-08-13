import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { ENVIRONMENT } from "../config/environment.module.js";
import type { Environment } from "../config/environment.js";
import * as schema from "./schema.js";

export const DATABASE_RUNTIME = Symbol("DATABASE_RUNTIME");

export type DatabaseRuntime = "api" | "worker";
export type Database = NodePgDatabase<typeof schema>;

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  readonly client: Database;

  private readonly pool: Pool;

  constructor(
    @Inject(ENVIRONMENT) environment: Environment,
    @Inject(DATABASE_RUNTIME) runtime: DatabaseRuntime,
  ) {
    const max = runtime === "api"
      ? environment.DATABASE_API_POOL_MAX
      : environment.DATABASE_WORKER_POOL_MAX;

    this.pool = new Pool({
      connectionString: environment.DATABASE_URL,
      max,
      connectionTimeoutMillis: environment.DATABASE_CONNECT_TIMEOUT_MS,
      statement_timeout: environment.DATABASE_STATEMENT_TIMEOUT_MS,
      application_name: `sift-${runtime}`,
    });
    this.client = drizzle(this.pool, { schema });
  }

  async onModuleInit(): Promise<void> {
    await this.ping();
  }

  async ping(): Promise<void> {
    await this.client.execute(sql`select 1`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
