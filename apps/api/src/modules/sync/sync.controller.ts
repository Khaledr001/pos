import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { SyncService } from "./sync.service.js";
import { SyncPullSchema, SyncPushSchema, type SyncPullDto, type SyncPushDto } from "./dto.js";

@ApiTags("sync")
@Controller("sync")
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /**
   * Push what the terminal created offline.
   *
   * Needs `sale:create` because that is what it ultimately does. A device token
   * without it cannot upload sales, which is the correct answer for a terminal
   * signed in as a viewer.
   */
  @Post("push")
  @RequirePermissions("sale:create")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Upload offline records; idempotent on localId" })
  push(@Body(zodPipe(SyncPushSchema)) dto: SyncPushDto) {
    return this.sync.push(dto);
  }

  @Post("pull")
  @RequirePermissions("product:read")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Download everything changed since the checkpoint" })
  pull(@Body(zodPipe(SyncPullSchema)) dto: SyncPullDto) {
    return this.sync.pull(dto);
  }
}
