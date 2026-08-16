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
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { BranchesService } from "./branches.service.js";
import {
  CreateBranchSchema,
  ListBranchesSchema,
  UpdateBranchSchema,
  type CreateBranchDto,
  type ListBranchesDto,
  type UpdateBranchDto,
} from "./dto.js";

/**
 * REFERENCE MODULE — controller
 *
 * A controller does three things and nothing else: validate input, call the
 * service, return the result. No database access, no branching on business
 * rules, no try/catch — the exception filter owns error shaping.
 *
 * Authentication is global (JwtAuthGuard), so nothing here declares it.
 * Authorisation is explicit per route, so a new endpoint that forgets
 * `@RequirePermissions` is visible in review as a missing line.
 */
@ApiTags("branches")
@Controller("branches")
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @RequirePermissions("branch:read")
  @ApiOperation({ summary: "List branches" })
  list(@Query(zodPipe(ListBranchesSchema)) query: ListBranchesDto) {
    return this.branches.list(query);
  }

  @Get(":id")
  @RequirePermissions("branch:read")
  @ApiOperation({ summary: "Get one branch" })
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.branches.findById(id);
  }

  @Post()
  @RequirePermissions("branch:write")
  @Audited("branches", "create")
  @ApiOperation({ summary: "Create a branch" })
  create(@Body(zodPipe(CreateBranchSchema)) dto: CreateBranchDto) {
    return this.branches.create(dto);
  }

  @Patch(":id")
  @RequirePermissions("branch:write")
  @Audited("branches", "update")
  @ApiOperation({ summary: "Update a branch" })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdateBranchSchema)) dto: UpdateBranchDto,
  ) {
    return this.branches.update(id, dto);
  }

  @Delete(":id")
  @RequirePermissions("branch:write")
  @Audited("branches", "delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Soft-delete a branch (refused while it holds stock)" })
  remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.branches.remove(id);
  }
}
