import { Controller, Get, Inject } from "@nestjs/common";

import { HealthService, type ReadinessResult } from "./health.service.js";

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
