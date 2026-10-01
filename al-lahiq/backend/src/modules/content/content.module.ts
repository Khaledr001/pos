import { Controller, Get, Injectable, Module, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiError } from '../../common/api-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { SettingsService } from '../settings/settings.service.js';

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly settings: SettingsService,
  ) {}

  banners(placement: string) {
    const now = new Date();
    return this.prisma.banner.findMany({
      where: {
        placement,
        active: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, title: true, subtitle: true, imageUrl: true, linkUrl: true, ctaLabel: true },
    });
  }

  /** Everything the home page needs in one call. */
  async home() {
    const [hero, strip, categories, brands, bestSellers, newArrivals] = await Promise.all([
      this.banners('home_hero'),
      this.banners('home_strip'),
      this.catalog.categoryTree(),
      this.catalog.brands(),
      this.catalog.bestSellers(8),
      this.catalog.productCards({}, 8, [{ createdAt: 'desc' }]),
    ]);
    return {
      hero,
      strip,
      categories: categories.map((c) => ({
        slug: c.slug,
        name: c.name,
        imageUrl: c.imageUrl,
        children: c.children.slice(0, 6).map((x) => ({ slug: x.slug, name: x.name })),
      })),
      featuredBrands: brands.filter((b) => b.featured).slice(0, 12),
      bestSellers,
      newArrivals,
    };
  }

  async page(slug: string) {
    const page = await this.prisma.page.findFirst({ where: { slug, published: true } });
    if (!page) throw ApiError.notFound('Page');
    return page;
  }

  async blog(page = 1) {
    const where = { kind: 'blog', published: true };
    const [total, items] = await Promise.all([
      this.prisma.page.count({ where }),
      this.prisma.page.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * 12,
        take: 12,
        select: { slug: true, title: true, excerpt: true, coverImageUrl: true, publishedAt: true },
      }),
    ]);
    return { total, page, items };
  }

  async branches() {
    return this.prisma.branch.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: {
        code: true, name: true, emirate: true, address: true, phone: true,
        lat: true, lng: true, openingHours: true, pickupEnabled: true,
      },
    });
  }

  async store() {
    const [store, cod] = await Promise.all([this.settings.get('store'), this.settings.get('cod')]);
    return { ...store, cod };
  }
}

@ApiTags('content')
@Controller('content')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get('home')
  home() {
    return this.content.home();
  }

  @Get('banners')
  banners(@Query('placement') placement = 'home_hero') {
    return this.content.banners(placement);
  }

  @Get('pages/:slug')
  page(@Param('slug') slug: string) {
    return this.content.page(slug);
  }

  @Get('blog')
  blog(@Query('page') page?: string) {
    return this.content.blog(Math.max(1, Number(page) || 1));
  }

  @Get('branches')
  branches() {
    return this.content.branches();
  }

  /** Public store details for the footer, contact page and WhatsApp button. */
  @Get('store')
  store() {
    return this.content.store();
  }
}

@Module({
  controllers: [ContentController],
  providers: [ContentService],
})
export class ContentModule {}
