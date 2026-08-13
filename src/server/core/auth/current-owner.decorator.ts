import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

export interface AuthenticatedOwner {
  id: string;
  authMethod: "static_bearer";
}

export const CurrentOwner = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedOwner => {
    const request = context.switchToHttp().getRequest<Request>();

    if (!request.user) {
      throw new Error("Authenticated owner context is missing");
    }

    return request.user;
  },
);
