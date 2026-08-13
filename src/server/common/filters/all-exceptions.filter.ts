import { randomUUID } from "node:crypto";

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

interface NormalizedError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(AllExceptionsFilter.name) private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== "http") {
      throw exception;
    }

    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    if (response.headersSent) {
      return;
    }

    const error = this.normalize(exception);
    const traceId = request.id ?? `req_${randomUUID()}`;
    response.setHeader("X-Request-ID", traceId);

    if (error.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        {
          err: exception,
          code: error.code,
          method: request.method,
          path: request.url,
          traceId,
          ownerId: request.user?.id,
        },
        error.message,
      );
    }

    response.status(error.status).json({
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
      traceId,
    });
  }

  private normalize(exception: unknown): NormalizedError {
    if (!(exception instanceof HttpException)) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: "INTERNAL.UNEXPECTED",
        message: "Something went wrong.",
      };
    }

    const status = exception.getStatus();
    const response = exception.getResponse();

    if (typeof response !== "object" || response === null) {
      return {
        status,
        code: this.defaultCode(status),
        message: String(response),
      };
    }

    const body = response as Record<string, unknown>;
    return {
      status,
      code: typeof body.code === "string" ? body.code : this.defaultCode(status),
      message: typeof body.message === "string" ? body.message : exception.message,
      ...(body.details === undefined ? {} : { details: body.details }),
    };
  }

  private defaultCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return "REQUEST.BAD";
      case HttpStatus.UNAUTHORIZED:
        return "AUTH.UNAUTHORIZED";
      case HttpStatus.FORBIDDEN:
        return "AUTH.FORBIDDEN";
      case HttpStatus.NOT_FOUND:
        return "RESOURCE.NOT_FOUND";
      case HttpStatus.CONFLICT:
        return "RESOURCE.CONFLICT";
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return "REQUEST.UNPROCESSABLE";
      case HttpStatus.SERVICE_UNAVAILABLE:
        return "SERVICE.UNAVAILABLE";
      default:
        return "INTERNAL.UNEXPECTED";
    }
  }
}
