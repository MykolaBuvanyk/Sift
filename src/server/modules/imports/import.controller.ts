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
import { ImportService } from "./import.service.js";

@Controller("imports")
export class ImportController {
  constructor(@Inject(ImportService) private readonly imports: ImportService) {}

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

  @Post(":id/retry")
  @HttpCode(200)
  retry(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
  ): Promise<RetryImportResponse> {
    return this.imports.retry(owner.id, id);
  }
}
