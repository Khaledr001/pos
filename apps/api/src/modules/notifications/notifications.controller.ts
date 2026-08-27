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
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { NotificationsService } from "./notifications.service.js";
import {
  ListNotificationsSchema,
  MarkAllReadSchema,
  type ListNotificationsDto,
  type MarkAllReadDto,
} from "./dto.js";

/**
 * Every route here reads or writes only the caller's own inbox —
 * `RequestContext.requireUser().id` is the filter in the service, never an id
 * taken from the request. That is a stronger control than a permission check
 * would be, since there is no cross-user read to authorise here at all.
 *
 * That is why this controller carries no `@RequirePermissions`, departing
 * from rule 8: per INVENTRA-SPEC.md:2517 this surface is "authenticated"
 * only, and the self-scoping is what makes that safe.
 */
@ApiTags("notifications")
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "List my notifications" })
  list(@Query(zodPipe(ListNotificationsSchema)) query: ListNotificationsDto) {
    return this.notifications.list(query);
  }

  @Get("unread-count")
  @ApiOperation({ summary: "How many of my notifications are unread" })
  unreadCount() {
    return this.notifications.unreadCount();
  }

  @Patch(":id/read")
  @ApiOperation({ summary: "Mark one of my notifications read" })
  markRead(@Param("id", ParseUUIDPipe) id: string) {
    return this.notifications.markRead(id);
  }

  @Post("read-all")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark my notifications read, optionally filtered by type" })
  markAllRead(@Body(zodPipe(MarkAllReadSchema)) dto: MarkAllReadDto) {
    return this.notifications.markAllRead(dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove one of my notifications" })
  remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.notifications.remove(id);
  }
}
