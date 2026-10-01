import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { zodPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { StorefrontRoute } from "../context/storefront.guard.js";
import { StorefrontContentService } from "./storefront-content.service.js";

const BlogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

@ApiTags("storefront")
@StorefrontRoute()
@Controller("storefront/content")
export class StorefrontContentController {
  constructor(private readonly content: StorefrontContentService) {}

  @Get("home")
  home() {
    return this.content.home();
  }

  @Get("store")
  store() {
    return this.content.store();
  }

  @Get("branches")
  branches() {
    return this.content.branches();
  }

  @Get("pages/:slug")
  page(@Param("slug") slug: string) {
    return this.content.page(slug);
  }

  @Get("blog")
  blog(@Query(zodPipe(BlogQuerySchema)) query: z.infer<typeof BlogQuerySchema>) {
    return this.content.blog(query.page, query.pageSize);
  }
}
