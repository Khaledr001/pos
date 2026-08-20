import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { AuditService } from "./audit.service.js";
import { ListAuditLogSchema, type ListAuditLogDto } from "./dto.js";

@ApiTags("audit")
@Controller("audit-log")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /**
   * Declared before `:id`-shaped routes would be, on principle — this
   * controller has none today, but entity-types is a literal segment and
   * belongs read first regardless.
   */
  @Get("entity-types")
  @RequirePermissions("audit:read")
  @ApiOperation({ summary: "Distinct entity types the trail has recorded" })
  entityTypes() {
    return this.audit.entityTypes();
  }

  @Get()
  @RequirePermissions("audit:read")
  @ApiOperation({ summary: "Who did what, to which entity, and when" })
  list(@Query(zodPipe(ListAuditLogSchema)) query: ListAuditLogDto) {
    return this.audit.list(query);
  }
}
