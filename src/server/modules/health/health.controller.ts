import { Controller, Get, Inject } from "@nestjs/common";

import { Public } from "../../core/auth/public.decorator.js";
import { HealthService, type ReadinessResult } from "./health.service.js";

@Public()
@Controller("health")
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get("live")
  liveness(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  readiness(): Promise<ReadinessResult> {
    return this.health.readiness();
  }
}
