import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { UsersService } from "./users.service.js";
import {
  CreateUserSchema,
  ListUsersSchema,
  SetPasswordSchema,
  SetPinSchema,
  UpdateUserSchema,
  type CreateUserDto,
  type ListUsersDto,
  type SetPasswordDto,
  type SetPinDto,
  type UpdateUserDto,
} from "./dto.js";

@ApiTags("users")
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions("user:read")
  @ApiOperation({ summary: "List staff" })
  list(@Query(zodPipe(ListUsersSchema)) query: ListUsersDto) {
    return this.users.list(query);
  }

  @Get(":id")
  @RequirePermissions("user:read")
  @ApiOperation({ summary: "Get one staff member" })
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.users.findById(id);
  }

  @Post()
  @RequirePermissions("user:write")
  @Audited("users", "create")
  @ApiOperation({ summary: "Add a staff member" })
  create(@Body(zodPipe(CreateUserSchema)) dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(":id")
  @RequirePermissions("user:write")
  @Audited("users", "update")
  @ApiOperation({ summary: "Update a staff member, including their ABAC limits" })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdateUserSchema)) dto: UpdateUserDto,
  ) {
    return this.users.update(id, dto);
  }

  /**
   * PUT, not PATCH: setting a credential replaces it outright. There is no
   * partial update of a password.
   */
  @Put(":id/password")
  @RequirePermissions("user:write")
  @Audited("users", "set_password")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Set a password and revoke every existing session" })
  setPassword(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(SetPasswordSchema)) dto: SetPasswordDto,
  ): Promise<void> {
    return this.users.setPassword(id, dto);
  }

  @Put(":id/pin")
  @RequirePermissions("user:write")
  @Audited("users", "set_pin")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Set or clear the counter PIN" })
  setPin(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(SetPinSchema)) dto: SetPinDto,
  ): Promise<void> {
    return this.users.setPin(id, dto);
  }

  @Delete(":id")
  @RequirePermissions("user:write")
  @Audited("users", "deactivate")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Deactivate a staff member and revoke their sessions" })
  deactivate(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.users.deactivate(id);
  }
}
