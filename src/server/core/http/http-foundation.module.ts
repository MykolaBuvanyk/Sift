import {
  type DynamicModule,
  Module,
  BadRequestException,
  ValidationPipe,
} from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";

import { AllExceptionsFilter } from "../../common/filters/all-exceptions.filter.js";
import { flattenValidationErrors } from "../../common/validation/flatten-validation-errors.js";
import type { Environment } from "../../config/environment.js";
import { createPinoHttpOptions } from "./pino-http-options.js";

@Module({})
export class HttpFoundationModule {
  static forRoot(environment: Environment): DynamicModule {
    return {
      module: HttpFoundationModule,
      imports: [LoggerModule.forRoot({ pinoHttp: createPinoHttpOptions(environment) })],
      providers: [
        {
          provide: APP_PIPE,
          useValue: new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            forbidUnknownValues: true,
            transform: true,
            transformOptions: { enableImplicitConversion: false },
            stopAtFirstError: false,
            validationError: { target: false, value: false },
            exceptionFactory: (errors) => new BadRequestException({
              code: "VALIDATION.FAILED",
              message: "Request validation failed.",
              details: flattenValidationErrors(errors),
            }),
          }),
        },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
      exports: [LoggerModule],
    };
  }
}
