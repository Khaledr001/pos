import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ImpersonationController } from "./impersonation.controller.js";
import { PlatformController } from "./platform.controller.js";
import { PlatformService } from "./platform.service.js";

/**
 * Imports AuthModule because impersonation mints a real session.
 *
 * Two controllers, because they authenticate differently: `PlatformController`
 * is `@PlatformOnly()`, while `ImpersonationController` is reached by the
 * impersonated session itself and cannot be. See that file for why.
 */
@Module({
  imports: [AuthModule],
  controllers: [PlatformController, ImpersonationController],
  providers: [PlatformService],
})
export class PlatformModule {}
