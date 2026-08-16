import { ping } from "@devsfleet/db";
import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/decorators/index.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";

/**
 * Liveness and readiness.
 *
 * Two endpoints, because they answer different questions and a load balancer
 * needs both:
 *
 *   /health   is the process up? Cheap, no dependencies. Never fails while the
 *             event loop turns.
 *   /ready    can it serve traffic? Checks Postgres. A failing readiness probe
 *             pulls the instance out of rotation without restarting it, which
 *             is what you want during a brief database blip.
 *
 * The POS also polls /health to decide online vs offline, so it must stay fast
 * and must never require authentication.
 */
@ApiTags("health")
@Controller()
export class HealthController {
  constructor(private readonly db: TenantDatabase) {}

  @Public()
  @Get("health")
  @ApiOperation({ summary: "Liveness probe" })
  health() {
    return {
      status: "ok",
      service: "devsfleet-api",
      version: process.env.npm_package_version ?? "0.1.0",
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get("ready")
  @ApiOperation({ summary: "Readiness probe — verifies database connectivity" })
  async ready() {
    const database = await ping(this.db.raw);

    if (!database) {
      throw new ServiceUnavailableException("Database is unreachable");
    }

    return { status: "ready", checks: { database: "up" } };
  }
}
