import { Inject, Injectable } from "@nestjs/common";
import type { ImportRowError } from "@sift/contracts";
import { and, asc, eq, gt } from "drizzle-orm";

import { DatabaseService } from "../../database/database.service.js";
import { importJobs, importRowErrors } from "../../database/schema.js";

@Injectable()
export class ImportErrorReportRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listOwnedBatch(
    ownerId: string,
    jobId: string,
    afterLineNumber: number,
    limit: number,
  ): Promise<ImportRowError[]> {
    const rows = await this.database.client
      .select({
        lineNumber: importRowErrors.lineNumber,
        errorCode: importRowErrors.errorCode,
        message: importRowErrors.message,
        rawExcerpt: importRowErrors.rawExcerpt,
      })
      .from(importRowErrors)
      .innerJoin(importJobs, eq(importJobs.id, importRowErrors.jobId))
      .where(and(
        eq(importJobs.id, jobId),
        eq(importJobs.ownerId, ownerId),
        gt(importRowErrors.lineNumber, afterLineNumber),
      ))
      .orderBy(asc(importRowErrors.lineNumber))
      .limit(limit);

    return rows.map((row) => ({
      line_number: row.lineNumber,
      error_code: row.errorCode,
      message: row.message,
      raw_excerpt: row.rawExcerpt,
    }));
  }
}
