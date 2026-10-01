import { Controller, Get, Param, type PipeTransform, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { zodPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { StorefrontRoute } from "../context/storefront.guard.js";
import {
  ListProductsSchema,
  PricesQuerySchema,
  SuggestQuerySchema,
  type ListProductsDto,
  type PricesQueryDto,
  type SuggestQueryDto,
} from "./dto.js";
import { StorefrontCatalogService } from "./storefront-catalog.service.js";

/**
 * Express 5 parses query strings "simple", so `attr[size]=1in` arrives as a
 * key literally named `attr[size]`. Folded back into `{ attr: { size } }`
 * before validation, so the schema describes the shape a client means.
 */
class FoldBracketKeysPipe implements PipeTransform<Record<string, unknown>, Record<string, unknown>> {
  transform(query: Record<string, unknown>): Record<string, unknown> {
    const folded: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(query ?? {})) {
      const match = /^(\w+)\[([^\]]+)\]$/.exec(key);
      if (!match) {
        folded[key] = value;
        continue;
      }
      const [, outer, inner] = match;
      const bucket = (folded[outer!] ??= {}) as Record<string, unknown>;
      bucket[inner!] = Array.isArray(value) ? value.join(",") : value;
    }
    return folded;
  }
}

@ApiTags("storefront")
@StorefrontRoute()
@Controller("storefront/catalog")
export class StorefrontCatalogController {
  constructor(private readonly catalog: StorefrontCatalogService) {}

  @Get("categories")
  categories() {
    return this.catalog.categoryTree();
  }

  @Get("categories/:slug")
  category(@Param("slug") slug: string) {
    return this.catalog.category(slug);
  }

  @Get("brands")
  brands() {
    return this.catalog.brands();
  }

  @Get("brands/:slug")
  brand(@Param("slug") slug: string) {
    return this.catalog.brand(slug);
  }

  @Get("products")
  products(@Query(new FoldBracketKeysPipe(), zodPipe(ListProductsSchema)) dto: ListProductsDto) {
    return this.catalog.listProducts(dto);
  }

  @Get("products/:slug")
  product(@Param("slug") slug: string) {
    return this.catalog.product(slug);
  }

  @Get("prices")
  prices(@Query(zodPipe(PricesQuerySchema)) query: PricesQueryDto) {
    return this.catalog.prices(query.skus);
  }

  @Get("suggest")
  suggest(@Query(zodPipe(SuggestQuerySchema)) query: SuggestQueryDto) {
    return this.catalog.suggest(query.q);
  }
}
