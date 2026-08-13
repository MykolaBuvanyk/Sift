import type { ExecutionContext } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { describe, expect, it } from "vitest";

import type { Environment } from "../../config/environment.js";
import { BearerTokenGuard } from "./bearer-token.guard.js";

const environment = {
  AUTH_BEARER_TOKEN: "test-token-with-at-least-32-characters",
  AUTH_OWNER_ID: "00000000-0000-4000-8000-000000000001",
} as Environment;

function createContext(authorization?: string): { context: ExecutionContext; request: Request } {
  const request = {
    headers: authorization ? { authorization } : {},
  } as Request;
  const handler = () => undefined;
  const controller = class TestController {};

  return {
    request,
    context: {
      getHandler: () => handler,
      getClass: () => controller,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
  };
}

describe("BearerTokenGuard", () => {
  const guard = new BearerTokenGuard(environment, new Reflector());

  it("rejects a request without a Bearer token", () => {
    const { context } = createContext();

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("rejects an invalid Bearer token", () => {
    const { context } = createContext("Bearer invalid-token");

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("derives the owner from server configuration", () => {
    const { context, request } = createContext(`Bearer ${environment.AUTH_BEARER_TOKEN}`);

    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toEqual({
      id: environment.AUTH_OWNER_ID,
      authMethod: "static_bearer",
    });
  });
});
