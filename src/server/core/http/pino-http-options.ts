import { randomUUID } from "node:crypto";

import type { Request } from "express";
import type { Options } from "pino-http";

import type { Environment } from "../../config/environment.js";

const MAX_REQUEST_ID_LENGTH = 128;

export function createPinoHttpOptions(environment: Environment): Options {
  return {
    level: environment.LOG_LEVEL,
    transport: environment.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, singleLine: true } }
      : undefined,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers[\"set-cookie\"]",
        "**.password",
        "**.passwordHash",
        "**.token",
        "**.apiKey",
        "**.secret",
      ],
      censor: "[REDACTED]",
    },
    genReqId: (request, response) => {
      const incoming = request.headers["x-request-id"];
      const requestId = typeof incoming === "string"
        && incoming.trim().length > 0
        && incoming.length < MAX_REQUEST_ID_LENGTH
        ? incoming.trim()
        : `req_${randomUUID()}`;

      response.setHeader("X-Request-ID", requestId);
      return requestId;
    },
    customProps: (request) => {
      const expressRequest = request as Request;
      return {
        traceId: expressRequest.id,
        ownerId: expressRequest.user?.id,
      };
    },
    serializers: {
      req: (request) => ({
        id: request.id,
        method: request.method,
        url: request.url,
      }),
      res: (response) => ({ statusCode: response.statusCode }),
    },
  };
}
