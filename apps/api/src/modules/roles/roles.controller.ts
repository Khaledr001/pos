import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { CreateRoleSchema, UpdateRoleSchema, type CreateRoleDto, type UpdateRoleDto } from "./dto.js";
import { RolesService } from "./roles.service.js";

@ApiTags("roles")
@Controller("roles")
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /**
   * `user:read`, not `role:write` — seeing what a role is called and what it
   * grants is needed by anyone who can view staff, if only to populate the
   * role picker on "add a user". Changing what a role grants is the
   * privileged action.
   */
  @Get()
  @RequirePermissions("user:read")
  @ApiOperation({ summary: "List roles and their permission grants" })
  list() {
    return this.roles.list();
  }

  @Get(":id")
  @RequirePermissions("user:read")
  @ApiOperation({ summary: "Get one role" })
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.roles.findById(id);
  }

  @Post()
  @RequirePermissions("role:write")
  @Audited("roles", "create")
  @ApiOperation({ summary: "Create a role — cannot grant more than you hold yourself" })
  create(@Body(zodPipe(CreateRoleSchema)) dto: CreateRoleDto) {
    return this.roles.create(dto);
  }

  @Patch(":id")
  @RequirePermissions("role:write")
  @Audited("roles", "update")
  @ApiOperation({ summary: "Update a role's name, description or permissions" })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdateRoleSchema)) dto: UpdateRoleDto,
  ) {
    return this.roles.update(id, dto);
  }

  @Delete(":id")
  @RequirePermissions("role:write")
  @Audited("roles", "delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a custom role — refused if seeded or still in use" })
  remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.roles.remove(id);
  }
}
