import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Audited, RequirePermissions } from "../../../common/decorators/index.js";
import { ExportFormatSchema } from "../../../common/http/send-export.js";
import { zodPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { z } from "zod";
import {
  FormSchema,
  LeadFiltersSchema,
  ListLeadsSchema,
  UpdateFormSchema,
  UpdateLeadSchema,
  type FormDto,
  type LeadFiltersDto,
  type ListLeadsDto,
  type UpdateFormDto,
  type UpdateLeadDto,
} from "./forms.dto.js";
import { FormsAdminService } from "./forms-admin.service.js";
import { LeadsAdminService } from "./leads-admin.service.js";
import { SiteAdminService } from "./site-admin.service.js";
import { ApplyTemplateSchema, type ApplyTemplateDto } from "./site.dto.js";

const ExportQuerySchema = LeadFiltersSchema.extend({ format: ExportFormatSchema });

@ApiTags("storefront-admin")
@Controller("storefront-admin/forms")
export class FormsAdminController {
  constructor(private readonly forms: FormsAdminService) {}

  @Get()
  @RequirePermissions("storefront:read")
  list() {
    return this.forms.list();
  }

  @Get(":slug")
  @RequirePermissions("storefront:read")
  get(@Param("slug") slug: string) {
    return this.forms.get(slug);
  }

  @Post()
  @RequirePermissions("storefront:write")
  @Audited("storefront_forms", "create")
  create(@Body(zodPipe(FormSchema)) dto: FormDto) {
    return this.forms.create(dto);
  }

  @Patch(":slug")
  @RequirePermissions("storefront:write")
  @Audited("storefront_forms", "update")
  update(@Param("slug") slug: string, @Body(zodPipe(UpdateFormSchema)) dto: UpdateFormDto) {
    return this.forms.update(slug, dto);
  }

  @Delete(":slug")
  @RequirePermissions("storefront:write")
  @Audited("storefront_forms", "delete")
  remove(@Param("slug") slug: string) {
    return this.forms.remove(slug);
  }
}

@ApiTags("storefront-admin")
@Controller("storefront-admin/leads")
export class LeadsAdminController {
  constructor(private readonly leads: LeadsAdminService) {}

  @Get()
  @RequirePermissions("storefront:read")
  list(@Query(zodPipe(ListLeadsSchema)) dto: ListLeadsDto) {
    return this.leads.list(dto);
  }

  /** Declared before `:id` so "export" is never read as an id. */
  @Get("export")
  @RequirePermissions("storefront:read")
  async export(@Query(zodPipe(ExportQuerySchema)) query: LeadFiltersDto & { format: z.infer<typeof ExportFormatSchema> }, @Res() res: Response) {
    const { format, ...filters } = query;
    await this.leads.export(filters, format, res);
  }

  @Get(":id")
  @RequirePermissions("storefront:read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.leads.get(id);
  }

  @Patch(":id")
  @RequirePermissions("storefront:write")
  update(@Param("id", ParseUUIDPipe) id: string, @Body(zodPipe(UpdateLeadSchema)) dto: UpdateLeadDto) {
    return this.leads.update(id, dto);
  }

  @Delete(":id")
  @RequirePermissions("storefront:write")
  @Audited("storefront_leads", "delete")
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.leads.remove(id);
  }
}

@ApiTags("storefront-admin")
@Controller("storefront-admin/site")
export class SiteAdminController {
  constructor(private readonly site: SiteAdminService) {}

  /** Start (or restart) the site from a template. Creates pages and forms that do not exist; replaces nothing unless asked. */
  @Post("apply-template")
  @RequirePermissions("storefront:write")
  @Audited("storefronts", "apply_template")
  applyTemplate(@Body(zodPipe(ApplyTemplateSchema)) dto: ApplyTemplateDto) {
    return this.site.applyTemplate(dto);
  }
}
