import { timingSafeEqual } from "node:crypto";

import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import { ENVIRONMENT } from "../../config/environment.module.js";
import type { Environment } from "../../config/environment.js";
import { IS_PUBLIC_ROUTE } from "./public.decorator.js";

@Injectable()
export class BearerTokenGuard implements CanActivate {
  constructor(
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearerToken(request.headers.authorization);

    if (!token || !this.matchesConfiguredToken(token)) {
      throw new UnauthorizedException({
        code: "AUTH.UNAUTHORIZED",
        message: "A valid Bearer token is required.",
      });
    }

    request.user = {
      id: this.environment.AUTH_OWNER_ID,
      authMethod: "static_bearer",
    };

    return true;
  }

  private extractBearerToken(authorization: string | undefined): string | undefined {
    const match = authorization?.match(/^Bearer ([^\s]+)$/i);
    return match?.[1];
  }

  private matchesConfiguredToken(candidate: string): boolean {
    const provided = Buffer.from(candidate);
    const expected = Buffer.from(this.environment.AUTH_BEARER_TOKEN);

    return provided.length === expected.length && timingSafeEqual(provided, expected);
  }
}
