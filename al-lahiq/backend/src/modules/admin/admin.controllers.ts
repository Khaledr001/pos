import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiError } from '../../common/api-error.js';
import type { StaffPrincipal } from '../../common/auth.js';
import { CurrentStaff } from '../../common/decorators/principals.js';
import { Roles, StaffAuthGuard } from '../../common/guards/auth.guards.js';
import { Emirate } from '../../generated/prisma/enums.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { InboundService } from '../pos-sync/inbound.service.js';
import { OutboxService } from '../pos-sync/outbox.service.js';
import { ReconciliationService } from '../pos-sync/reconciliation.service.js';
import { SettingKey, SettingsService, SETTING_DEFAULTS } from '../settings/settings.service.js';
import { StorageService } from '../storage/storage.service.js';
import { AdminCatalogService } from './admin-catalog.service.js';
import { AdminOpsService } from './admin-ops.service.js';
import {
  AdminCustomerQueryDto,
  AdminOrderQueryDto,
  AdminProductQueryDto,
  AttributeDto,
  BannerDto,
  BranchDto,
  BrandDto,
  CategoryDto,
  ChangeOrderStatusDto,
  CouponDto,
  PageDto,
  ReplaceDocumentsDto,
  ReplaceImagesDto,
  ReplaceLinksDto,
  ReplaceVariantAttributesDto,
  ReportQueryDto,
  ShippingRateDto,
  StaffDto,
  TradeDecisionDto,
  UpdateAttributeDto,
  UpdateBannerDto,
  UpdateBranchDto,
  UpdateBrandDto,
  UpdateCategoryDto,
  UpdateCouponDto,
  UpdatePageDto,
  UpdateProductDto,
  UpdateStaffDto,
  UpdateVariantDto,
} from './admin.dto.js';

const actor = (s: StaffPrincipal) => `staff:${s.id}`;

/** The parts of a Multer file we use. */
interface UploadedFileData {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

@ApiTags('admin')
@Controller('admin')
@UseGuards(StaffAuthGuard)
@Roles('MANAGER', 'CONTENT_EDITOR')
export class AdminCatalogController {
  constructor(
    private readonly catalog: AdminCatalogService,
    private readonly storage: StorageService,
  ) {}

  @Get('products')
  products(@Query() q: AdminProductQueryDto) {
    return this.catalog.products(q);
  }

  @Get('products/pick')
  pick(@Query('q') q = '') {
    return this.catalog.pick(q);
  }

  @Get('products/:id')
  product(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.product(id);
  }

  @Patch('products/:id')
  updateProduct(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.catalog.updateProduct(id, dto);
  }

  @Put('products/:id/images')
  images(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplaceImagesDto) {
    return this.catalog.replaceImages(id, dto);
  }

  @Put('products/:id/documents')
  documents(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplaceDocumentsDto) {
    return this.catalog.replaceDocuments(id, dto);
  }

  @Put('products/:id/links')
  links(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplaceLinksDto) {
    return this.catalog.replaceLinks(id, dto);
  }

  @Put('variants/:id/attributes')
  variantAttributes(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplaceVariantAttributesDto) {
    return this.catalog.replaceVariantAttributes(id, dto);
  }

  @Patch('variants/:id')
  updateVariant(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVariantDto) {
    return this.catalog.updateVariant(id, dto);
  }

  @Get('categories')
  categories() {
    return this.catalog.categories();
  }

  @Post('categories')
  createCategory(@Body() dto: CategoryDto) {
    return this.catalog.createCategory(dto);
  }

  @Patch('categories/:id')
  updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.catalog.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @HttpCode(204)
  deleteCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteCategory(id);
  }

  @Get('brands')
  brands() {
    return this.catalog.brands();
  }

  @Post('brands')
  createBrand(@Body() dto: BrandDto) {
    return this.catalog.createBrand(dto);
  }

  @Patch('brands/:id')
  updateBrand(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBrandDto) {
    return this.catalog.updateBrand(id, dto);
  }

  @Delete('brands/:id')
  @HttpCode(204)
  deleteBrand(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteBrand(id);
  }

  @Get('attributes')
  attributes() {
    return this.catalog.attributes();
  }

  @Post('attributes')
  createAttribute(@Body() dto: AttributeDto) {
    return this.catalog.createAttribute(dto);
  }

  @Patch('attributes/:id')
  updateAttribute(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAttributeDto) {
    return this.catalog.updateAttribute(id, dto);
  }

  @Delete('attributes/:id')
  @HttpCode(204)
  deleteAttribute(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteAttribute(id);
  }

  /** Multipart upload (field "file"): product images, category images, datasheets. */
  @Post('uploads')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(@UploadedFile() file?: UploadedFileData) {
    if (!file) throw ApiError.badRequest('FILE_REQUIRED', 'Choose a file to upload');
    return this.storage.save(file);
  }
}

@ApiTags('admin')
@Controller('admin/orders')
@UseGuards(StaffAuthGuard)
@Roles('MANAGER', 'ORDER_STAFF')
export class AdminOrdersController {
  constructor(
    private readonly ops: AdminOpsService,
    private readonly payments: PaymentsService,
    private readonly invoices: InvoicesService,
  ) {}

  @Get()
  list(@Query() q: AdminOrderQueryDto) {
    return this.ops.listOrders(q);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.ops.order(id);
  }

  @Post(':id/status')
  @HttpCode(200)
  status(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeOrderStatusDto, @CurrentStaff() s: StaffPrincipal) {
    return this.ops.changeStatus(id, dto, actor(s));
  }

  @Post(':id/refund')
  @HttpCode(200)
  @Roles('MANAGER')
  async refund(@Param('id', ParseUUIDPipe) id: string, @CurrentStaff() s: StaffPrincipal) {
    await this.payments.refund(id, actor(s));
    return this.ops.order(id);
  }

  @Get(':id/invoice.pdf')
  async invoice(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const pdf = await this.invoices.pdf(id);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `inline; filename="${pdf.filename}"`);
    res.send(pdf.buffer);
  }
}

@ApiTags('admin')
@Controller('admin/customers')
@UseGuards(StaffAuthGuard)
@Roles('MANAGER', 'ORDER_STAFF')
export class AdminCustomersController {
  constructor(private readonly ops: AdminOpsService) {}

  @Get()
  list(@Query() q: AdminCustomerQueryDto) {
    return this.ops.listCustomers(q);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.ops.customer(id);
  }

  @Post(':id/trade')
  @HttpCode(200)
  @Roles('MANAGER')
  trade(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TradeDecisionDto) {
    return this.ops.tradeDecision(id, dto.decision);
  }
}

@ApiTags('admin')
@Controller('admin/content')
@UseGuards(StaffAuthGuard)
@Roles('MANAGER', 'CONTENT_EDITOR')
export class AdminContentController {
  constructor(private readonly ops: AdminOpsService) {}

  @Get('pages')
  pages(@Query('kind') kind?: string) {
    return this.ops.pages(kind);
  }

  @Get('pages/:id')
  page(@Param('id', ParseUUIDPipe) id: string) {
    return this.ops.page(id);
  }

  @Post('pages')
  createPage(@Body() dto: PageDto) {
    return this.ops.createPage(dto);
  }

  @Patch('pages/:id')
  updatePage(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePageDto) {
    return this.ops.updatePage(id, dto);
  }

  @Delete('pages/:id')
  @HttpCode(204)
  deletePage(@Param('id', ParseUUIDPipe) id: string) {
    return this.ops.deletePage(id);
  }

  @Get('banners')
  banners() {
    return this.ops.banners();
  }

  @Post('banners')
  createBanner(@Body() dto: BannerDto) {
    return this.ops.createBanner(dto);
  }

  @Patch('banners/:id')
  updateBanner(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBannerDto) {
    return this.ops.updateBanner(id, dto);
  }

  @Delete('banners/:id')
  @HttpCode(204)
  deleteBanner(@Param('id', ParseUUIDPipe) id: string) {
    return this.ops.deleteBanner(id);
  }
}

@ApiTags('admin')
@Controller('admin')
@UseGuards(StaffAuthGuard)
@Roles('MANAGER')
export class AdminSettingsController {
  constructor(
    private readonly ops: AdminOpsService,
    private readonly settings: SettingsService,
  ) {}

  @Get('settings')
  all() {
    return this.settings.all();
  }

  @Patch('settings/:key')
  update(@Param('key') key: string, @Body() body: Record<string, unknown>) {
    if (!(key in SETTING_DEFAULTS)) throw ApiError.notFound('Setting');
    const allowed = Object.keys(SETTING_DEFAULTS[key as SettingKey]);
    const clean = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
    return this.settings.set(key as SettingKey, clean as never);
  }

  @Get('coupons')
  coupons() {
    return this.ops.coupons();
  }

  @Post('coupons')
  createCoupon(@Body() dto: CouponDto) {
    return this.ops.createCoupon(dto);
  }

  @Patch('coupons/:id')
  updateCoupon(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCouponDto) {
    return this.ops.updateCoupon(id, dto);
  }

  @Delete('coupons/:id')
  @HttpCode(204)
  deleteCoupon(@Param('id', ParseUUIDPipe) id: string) {
    return this.ops.deleteCoupon(id);
  }

  @Get('shipping-rates')
  shippingRates() {
    return this.ops.shippingRates();
  }

  @Put('shipping-rates/:emirate')
  shippingRate(@Param('emirate') emirate: string, @Body() dto: ShippingRateDto) {
    if (!(Object.values(Emirate) as string[]).includes(emirate)) throw ApiError.notFound('Emirate');
    return this.ops.upsertShippingRate(emirate as Emirate, dto);
  }

  @Get('branches')
  branches() {
    return this.ops.branches();
  }

  @Post('branches')
  createBranch(@Body() dto: BranchDto) {
    return this.ops.createBranch(dto);
  }

  @Patch('branches/:id')
  updateBranch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto) {
    return this.ops.updateBranch(id, dto);
  }

  @Get('reports/dashboard')
  dashboard(@Query() q: ReportQueryDto) {
    return this.ops.dashboard(q.days);
  }
}

@ApiTags('admin')
@Controller('admin/staff')
@UseGuards(StaffAuthGuard)
@Roles('OWNER')
export class AdminStaffController {
  constructor(private readonly ops: AdminOpsService) {}

  @Get()
  list() {
    return this.ops.staff();
  }

  @Post()
  create(@Body() dto: StaffDto) {
    return this.ops.createStaff(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStaffDto, @CurrentStaff() s: StaffPrincipal) {
    return this.ops.updateStaff(id, dto, s.id);
  }
}

@ApiTags('admin')
@Controller('admin/sync')
@UseGuards(StaffAuthGuard)
@Roles('MANAGER')
export class AdminSyncController {
  constructor(
    private readonly ops: AdminOpsService,
    private readonly outbox: OutboxService,
    private readonly inbound: InboundService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Get('status')
  status() {
    return this.ops.syncStatus();
  }

  @Get('outbox')
  outboxEvents(@Query('status') status?: string) {
    return this.ops.outboxEvents(status);
  }

  @Get('inbound')
  inboundEvents(@Query('status') status?: string) {
    return this.ops.inboundEvents(status);
  }

  @Post('outbox/:id/retry')
  @HttpCode(202)
  async retryOutbox(@Param('id', ParseUUIDPipe) id: string) {
    await this.outbox.retry(id);
    return { status: 'queued' };
  }

  @Post('inbound/:id/retry')
  @HttpCode(202)
  async retryInbound(@Param('id', ParseUUIDPipe) id: string) {
    await this.inbound.retry(id);
    return { status: 'queued' };
  }

  /** "Resync now": runs the reconciliation in the background. */
  @Post('reconcile')
  @HttpCode(202)
  reconcile() {
    void this.reconciliation.run().catch(() => undefined);
    return { status: 'started' };
  }
}
