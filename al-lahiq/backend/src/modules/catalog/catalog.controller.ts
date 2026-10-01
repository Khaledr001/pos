import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CustomerPrincipal } from '../../common/auth.js';
import { MaybeCustomer } from '../../common/decorators/principals.js';
import { OptionalCustomerGuard } from '../../common/guards/auth.guards.js';
import { CatalogService } from './catalog.service.js';
import { ListProductsDto } from './dto/list-products.dto.js';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  categories() {
    return this.catalog.categoryTree();
  }

  @Get('categories/:slug')
  category(@Param('slug') slug: string) {
    return this.catalog.category(slug);
  }

  @Get('brands')
  brands() {
    return this.catalog.brands();
  }

  @Get('brands/:slug')
  brand(@Param('slug') slug: string) {
    return this.catalog.brand(slug);
  }

  @Get('products')
  products(@Query() dto: ListProductsDto) {
    return this.catalog.listProducts(dto);
  }

  @Get('products/:slug')
  product(@Param('slug') slug: string) {
    return this.catalog.product(slug);
  }

  /** Prices for the current customer (trade prices when logged in). */
  @Get('prices')
  @UseGuards(OptionalCustomerGuard)
  prices(@Query('skus') skus: string, @MaybeCustomer() customer?: CustomerPrincipal) {
    const list = (skus ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return this.catalog.prices(list, customer?.id);
  }

  @Get('suggest')
  suggest(@Query('q') q: string) {
    return this.catalog.suggest(q ?? '');
  }
}
