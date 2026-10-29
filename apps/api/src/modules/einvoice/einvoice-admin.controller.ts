import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { EinvoiceDocumentsService } from "./einvoice-documents.service.js";
import { EinvoiceSettingsService } from "./einvoice-settings.service.js";
import {
  ListDocumentsSchema,
  UpdateEinvoiceSettingsSchema,
  UpdateProviderSchema,
  type ListDocumentsDto,
  type UpdateEinvoiceSettingsDto,
  type UpdateProviderDto,
} from "./dto.js";

/**
 * UAE e-invoicing, administration. Configuration needs the settings
 * permissions; the register is read with `sale:read`, and the two actions that
 * act on an issued document (retry, send) with `sale:void` — the same
 * authority over issued documents a void carries.
 */
@ApiTags("einvoice")
@Controller("einvoice")
export class EinvoiceAdminController {
  constructor(
    private readonly settings: EinvoiceSettingsService,
    private readonly documents: EinvoiceDocumentsService,
  ) {}

  @Get("settings")
  @RequirePermissions("settings:read")
  @ApiOperation({ summary: "E-invoicing settings, provider and readiness" })
  getSettings() {
    return this.settings.view();
  }

  @Put("settings")
  @RequirePermissions("settings:write")
  @Audited("einvoice_settings", "update")
  @ApiOperation({ summary: "Change e-invoicing settings" })
  updateSettings(@Body(zodPipe(UpdateEinvoiceSettingsSchema)) dto: UpdateEinvoiceSettingsDto) {
    return this.settings.update(dto);
  }

  @Put("provider")
  @RequirePermissions("settings:write")
  @Audited("einvoice_provider", "update")
  @ApiOperation({ summary: "Connect an e-invoicing provider (credentials are write-only)" })
  updateProvider(@Body(zodPipe(UpdateProviderSchema)) dto: UpdateProviderDto) {
    return this.settings.updateProvider(dto);
  }

  @Post("provider/test")
  @RequirePermissions("settings:write")
  @ApiOperation({ summary: "Test the provider connection" })
  testProvider() {
    return this.settings.testProvider();
  }

  @Get("readiness")
  @RequirePermissions("settings:read")
  @ApiOperation({ summary: "What still stands between this business and a valid e-invoice" })
  readiness() {
    return this.settings.readinessReport();
  }

  @Get("documents")
  @RequirePermissions("sale:read")
  @ApiOperation({ summary: "The e-invoice register" })
  list(@Query(zodPipe(ListDocumentsSchema)) query: ListDocumentsDto) {
    return this.documents.list(query);
  }

  /** Before `:id`, so "xml" is never read as part of an id. */
  @Get("documents/:id/xml")
  @RequirePermissions("sale:read")
  @ApiOperation({ summary: "The PINT AE XML of a document" })
  async xml(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const file = await this.documents.xml(id);
    res.setHeader("content-type", "application/xml; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="${file.filename}"`);
    res.setHeader("content-length", String(Buffer.byteLength(file.body)));
    res.end(file.body);
  }

  @Get("documents/:id")
  @RequirePermissions("sale:read")
  @ApiOperation({ summary: "One document: issues, history, provider reference" })
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.documents.get(id);
  }

  @Post("documents/:id/retry")
  @RequirePermissions("sale:void")
  @Audited("einvoice_document", "retry")
  @ApiOperation({ summary: "Re-queue a rejected or failed document, rebuilt from the current data" })
  retry(@Param("id", ParseUUIDPipe) id: string) {
    return this.documents.retry(id);
  }

  @Post("documents/:id/send")
  @RequirePermissions("sale:void")
  @Audited("einvoice_document", "send")
  @ApiOperation({ summary: "Release a document held for review" })
  send(@Param("id", ParseUUIDPipe) id: string) {
    return this.documents.send(id);
  }
}
