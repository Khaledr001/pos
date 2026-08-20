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
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { QuotationsService } from "./quotations.service.js";
import {
  ConvertQuotationSchema,
  ConvertQuotationToOrderSchema,
  CreateQuotationSchema,
  ListQuotationsSchema,
  type ConvertQuotationDto,
  type ConvertQuotationToOrderDto,
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

  /**
   * Declared BEFORE `:id` — Express matches in order, so a literal segment
   * registered after a parameterised sibling is never reached.
   *
   * `quotation:read`, not `:write`: handing a customer a copy of the quote
   * they were already shown is reading it, not changing it. The POST below
   * stays on `:write` because it mutates the record.
   */
  @Get(":id/pdf")
  @RequirePermissions("quotation:read")
  @ApiOperation({ summary: "Download this quotation as a PDF" })
  async downloadPdf(
    @Param("id", ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, body } = await this.quotations.renderPdf(id);

    // `@Res()` because the global TransformInterceptor wraps every returned
    // value in the JSON envelope, and a PDF wrapped in JSON is not a PDF.
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", `attachment; filename="${filename}"`);
    res.setHeader("content-length", String(body.length));
    res.end(body);
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

  /**
   * `order:write`, not `sale:create` — this commits to an ORDER, and no
   * money moves until it is eventually fulfilled.
   */
  @Post(":id/convert-to-order")
  @RequirePermissions("order:write")
  @Audited("quotation", "convert_to_order")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Turn an accepted quotation into an order — reserves nothing yet" })
  convertToOrder(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(ConvertQuotationToOrderSchema)) dto: ConvertQuotationToOrderDto,
  ) {
    return this.quotations.convertToOrder(id, dto);
  }

  @Post(":id/cancel")
  @RequirePermissions("quotation:write")
  @Audited("quotation", "cancel")
  @HttpCode(HttpStatus.OK)
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.quotations.cancel(id);
  }

  @Post(":id/pdf")
  @RequirePermissions("quotation:write")
  @Audited("quotation", "generate_pdf")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Render, upload and record this quotation's PDF" })
  generatePdf(@Param("id", ParseUUIDPipe) id: string) {
    return this.quotations.generatePdf(id);
  }
}
