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
import { ExpensesService } from "./expenses.service.js";
import {
  CreateExpenseSchema,
  ListExpensesSchema,
  UpdateExpenseSchema,
  type CreateExpenseDto,
  type ListExpensesDto,
  type UpdateExpenseDto,
} from "./dto.js";

@ApiTags("expenses")
@Controller("expenses")
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @RequirePermissions("expense:read")
  @ApiOperation({ summary: "Expenses, filtered by date range and category" })
  list(@Query(zodPipe(ListExpensesSchema)) query: ListExpensesDto) {
    return this.expenses.list(query);
  }

  /** Before `:id`, or Express reads "categories" as an id. */
  @Get("categories")
  @RequirePermissions("expense:read")
  @ApiOperation({ summary: "Categories in use, most-used first" })
  categories() {
    return this.expenses.categories();
  }

  @Post()
  @RequirePermissions("expense:write")
  @Audited("expense", "create")
  @ApiOperation({ summary: "Record an expense" })
  create(@Body(zodPipe(CreateExpenseSchema)) dto: CreateExpenseDto) {
    return this.expenses.create(dto);
  }

  @Patch(":id")
  @RequirePermissions("expense:write")
  @Audited("expense", "update")
  @ApiOperation({ summary: "Amend an expense on a day that is still open" })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdateExpenseSchema)) dto: UpdateExpenseDto,
  ) {
    return this.expenses.update(id, dto);
  }

  @Delete(":id")
  @RequirePermissions("expense:delete")
  @Audited("expense", "delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Soft delete an expense" })
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.expenses.remove(id);
  }
}
