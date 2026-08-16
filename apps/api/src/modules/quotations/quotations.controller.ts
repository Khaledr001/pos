import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { QuotationsService } from "./quotations.service.js";
import {
  ConvertQuotationSchema,
  CreateQuotationSchema,
  ListQuotationsSchema,
  type ConvertQuotationDto,
  type CreateQuotationDto,
  type ListQuotationsDto,
} from "./dto.js";

@ApiTags("quotations")
@Controller("quotations")
export class QuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Get()
  @RequirePermissions("quotation:read")
  list(@Query(zodPipe(ListQuotationsSchema)) query: ListQuotationsDto) {
    return this.quotations.list(query);
  }

  @Get(":id")
  @RequirePermissions("quotation:read")
  findById(@Param("id", ParseUUIDPipe) id: string) {
    return this.quotations.findById(id);
  }

  @Post()
  @RequirePermissions("quotation:write")
  @Audited("quotation", "create")
  create(@Body(zodPipe(CreateQuotationSchema)) dto: CreateQuotationDto) {
    return this.quotations.create(dto);
  }

  @Post(":id/send")
  @RequirePermissions("quotation:write")
  @Audited("quotation", "send")
  @HttpCode(HttpStatus.OK)
  send(@Param("id", ParseUUIDPipe) id: string) {
    return this.quotations.send(id);
  }

  /**
   * `sale:create`, because that is what this does. Someone who may quote a
   * price is not thereby someone who may ring one up.
   */
  @Post(":id/convert")
  @RequirePermissions("sale:create")
  @Audited("quotation", "convert")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Turn an accepted quotation into a sale at the quoted prices" })
  convert(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(ConvertQuotationSchema)) dto: ConvertQuotationDto,
  ) {
    return this.quotations.convert(id, dto);
  }

  @Post(":id/cancel")
  @RequirePermissions("quotation:write")
  @Audited("quotation", "cancel")
  @HttpCode(HttpStatus.OK)
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.quotations.cancel(id);
  }
}
