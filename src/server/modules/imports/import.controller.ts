import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
} from "@nestjs/common";
import type {
  CreateImportResponse,
  FinalizeImportResponse,
  ImportJob,
  RetryImportResponse,
} from "@sift/contracts";
import type { Response } from "express";

import {
  CurrentOwner,
  type AuthenticatedOwner,
} from "../../core/auth/current-owner.decorator.js";
import { CreateImportDto } from "./dto/create-import.dto.js";
import { ImportErrorReportService } from "./import-error-report.service.js";
import { ImportService } from "./import.service.js";

@Controller("imports")
export class ImportController {
  constructor(
    @Inject(ImportService) private readonly imports: ImportService,
    @Inject(ImportErrorReportService)
    private readonly errorReports: ImportErrorReportService,
  ) {}

  @Post()
  async create(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Body() metadata: CreateImportDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CreateImportResponse> {
    const result = await this.imports.create(owner.id, metadata);
    response.status(result.created ? 201 : 200);
    response.setHeader("Location", `/imports/${result.response.job_id}`);
    return result.response;
  }

  @Post(":id/finalize")
  @HttpCode(200)
  finalize(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
  ): Promise<FinalizeImportResponse> {
    return this.imports.finalize(owner.id, id);
  }

  @Get(":id")
  getStatus(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
  ): Promise<ImportJob> {
    return this.imports.getStatus(owner.id, id);
  }

  @Get(":id/errors")
  async downloadErrors(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const report = await this.errorReports.open(owner.id, id);
    const stream = report.getStream();
    const destroyOnDisconnect = (): void => {
      stream.destroy();
    };
    const removeDisconnectHandler = (): void => {
      response.off("close", destroyOnDisconnect);
    };

    response.once("close", destroyOnDisconnect);
    stream.once("close", removeDisconnectHandler);
    stream.once("end", removeDisconnectHandler);
    return report;
  }

  @Post(":id/retry")
  @HttpCode(200)
  retry(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
  ): Promise<RetryImportResponse> {
    return this.imports.retry(owner.id, id);
  }
}
