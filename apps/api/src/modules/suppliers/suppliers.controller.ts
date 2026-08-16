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
import { SuppliersService } from "./suppliers.service.js";
import {
  CreateSupplierSchema,
  ListSuppliersSchema,
  UpdateSupplierSchema,
  type CreateSupplierDto,
  type ListSuppliersDto,
  type UpdateSupplierDto,
} from "./dto.js";

@ApiTags("suppliers")
@Controller("suppliers")
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermissions("supplier:read")
  @ApiOperation({ summary: "Suppliers, searchable by name, company or phone" })
  list(@Query(zodPipe(ListSuppliersSchema)) query: ListSuppliersDto) {
    return this.suppliers.list(query);
  }

  @Get(":id")
  @RequirePermissions("supplier:read")
  findById(@Param("id", ParseUUIDPipe) id: string) {
    return this.suppliers.findById(id);
  }

  @Post()
  @RequirePermissions("supplier:write")
  @Audited("supplier", "create")
  create(@Body(zodPipe(CreateSupplierSchema)) dto: CreateSupplierDto) {
    return this.suppliers.create(dto);
  }

  @Patch(":id")
  @RequirePermissions("supplier:write")
  @Audited("supplier", "update")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdateSupplierSchema)) dto: UpdateSupplierDto,
  ) {
    return this.suppliers.update(id, dto);
  }

  @Delete(":id")
  @RequirePermissions("supplier:write")
  @Audited("supplier", "delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.suppliers.remove(id);
  }
}
