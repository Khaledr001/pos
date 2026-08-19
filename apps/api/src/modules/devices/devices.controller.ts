import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { DevicesService } from "./devices.service.js";
import {
  CreateDeviceSchema,
  ListDevicesSchema,
  UpdateDeviceSchema,
  type CreateDeviceDto,
  type ListDevicesDto,
  type UpdateDeviceDto,
} from "./dto.js";

@ApiTags("devices")
@Controller("devices")
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  /**
   * Reads stay on `branch:read` — a manager who can see a branch can see its
   * terminals. Writes are `device:manage`, which until now was declared in
   * PERMISSIONS and enforced nowhere: registering a device creates the identity
   * that PIN logins are accepted against, so it is not the same authority as
   * renaming a branch.
   */
  @Get()
  @RequirePermissions("branch:read")
  @ApiOperation({ summary: "List devices" })
  list(@Query(zodPipe(ListDevicesSchema)) query: ListDevicesDto) {
    return this.devices.list(query);
  }

  @Get(":id")
  @RequirePermissions("branch:read")
  @ApiOperation({ summary: "Get one device" })
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.devices.findById(id);
  }

  @Post()
  @RequirePermissions("device:manage")
  @Audited("devices", "create")
  @ApiOperation({ summary: "Register a new POS terminal" })
  create(@Body(zodPipe(CreateDeviceSchema)) dto: CreateDeviceDto) {
    return this.devices.create(dto);
  }

  @Patch(":id")
  @RequirePermissions("device:manage")
  @Audited("devices", "update")
  @ApiOperation({ summary: "Update a device" })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdateDeviceSchema)) dto: UpdateDeviceDto,
  ) {
    return this.devices.update(id, dto);
  }
}
