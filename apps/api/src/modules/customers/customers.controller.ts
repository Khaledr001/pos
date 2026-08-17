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
import { CustomersService } from "./customers.service.js";
import {
  AdjustLoyaltySchema,
  CreateCustomerSchema,
  ListCustomersSchema,
  RecordPaymentSchema,
  SetCreditSchema,
  UpdateCustomerSchema,
  type AdjustLoyaltyDto,
  type CreateCustomerDto,
  type ListCustomersDto,
  type RecordPaymentDto,
  type SetCreditDto,
  type UpdateCustomerDto,
} from "./dto.js";

@ApiTags("customers")
@Controller("customers")
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions("customer:read")
  list(@Query(zodPipe(ListCustomersSchema)) query: ListCustomersDto) {
    return this.customers.list(query);
  }

  @Get(":id")
  @RequirePermissions("customer:read")
  findById(@Param("id", ParseUUIDPipe) id: string) {
    return this.customers.findById(id);
  }

  @Get(":id/payments")
  @RequirePermissions("customer:read")
  paymentHistory(@Param("id", ParseUUIDPipe) id: string) {
    return this.customers.paymentHistory(id);
  }

  @Get(":id/loyalty")
  @RequirePermissions("customer:read")
  loyaltyHistory(@Param("id", ParseUUIDPipe) id: string) {
    return this.customers.loyaltyHistory(id);
  }

  @Post()
  @RequirePermissions("customer:write")
  @Audited("customer", "create")
  create(@Body(zodPipe(CreateCustomerSchema)) dto: CreateCustomerDto) {
    return this.customers.create(dto);
  }

  @Patch(":id")
  @RequirePermissions("customer:write")
  @Audited("customer", "update")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdateCustomerSchema)) dto: UpdateCustomerDto,
  ) {
    return this.customers.update(id, dto);
  }

  /**
   * `customer:credit`, separate from `customer:write` — see the service for
   * why raising a credit ceiling is not the same power as fixing a phone number.
   */
  @Patch(":id/credit")
  @RequirePermissions("customer:credit")
  @Audited("customer", "set-credit")
  setCredit(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(SetCreditSchema)) dto: SetCreditDto,
  ) {
    return this.customers.setCredit(id, dto);
  }

  @Post(":id/payments")
  @RequirePermissions("customer:credit")
  @Audited("customer_payment", "create")
  @ApiOperation({ summary: "Settle an old credit invoice" })
  recordPayment(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(RecordPaymentSchema)) dto: RecordPaymentDto,
  ) {
    return this.customers.recordPayment(id, dto);
  }

  @Post(":id/loyalty")
  @RequirePermissions("customer:credit")
  @Audited("loyalty_transaction", "adjust")
  @ApiOperation({ summary: "Grant or redeem loyalty points manually" })
  adjustLoyalty(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(AdjustLoyaltySchema)) dto: AdjustLoyaltyDto,
  ) {
    return this.customers.adjustLoyalty(id, dto);
  }

  @Delete(":id")
  @RequirePermissions("customer:write")
  @Audited("customer", "delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.customers.remove(id);
  }
}
