import { PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  CouponType,
  Emirate,
  OrderStatus,
  ProductLinkKind,
  StaffRole,
} from '../../generated/prisma/enums.js';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
/** Accepts absolute URLs and paths served by this API (/uploads/...). */
const URL_OR_PATH = /^(https?:\/\/|\/)[^\s]*$/;

export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 25;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

// ── catalog ──

export class AdminProductQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['published', 'draft'])
  status?: 'published' | 'draft';

  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

class SpecDto {
  @IsString()
  @Length(1, 80)
  label: string;

  @IsString()
  @Length(1, 300)
  value: string;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @Length(2, 300)
  name?: string;

  @IsOptional()
  @Matches(SLUG, { message: 'slug may only contain lowercase letters, numbers and dashes' })
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  @IsOptional()
  @IsUUID()
  brandId?: string | null;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsBoolean()
  pickupOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => SpecDto)
  specs?: SpecDto[];

  @IsOptional()
  @IsString()
  @MaxLength(70)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(170)
  seoDescription?: string;
}

class ImageDto {
  @Matches(URL_OR_PATH)
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  alt?: string;
}

export class ReplaceImagesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ImageDto)
  images: ImageDto[];
}

class DocumentDto {
  @IsString()
  @Length(1, 120)
  title: string;

  @Matches(URL_OR_PATH)
  url: string;

  @IsIn(['datasheet', 'manual', 'certificate'])
  kind: string;
}

export class ReplaceDocumentsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DocumentDto)
  documents: DocumentDto[];
}

class LinkDto {
  @IsUUID()
  toId: string;

  @IsIn(Object.values(ProductLinkKind))
  kind: ProductLinkKind;
}

export class ReplaceLinksDto {
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => LinkDto)
  links: LinkDto[];
}

class VariantAttributeDto {
  @IsUUID()
  attributeId: string;

  @IsString()
  @Length(1, 100)
  value: string;
}

export class ReplaceVariantAttributesDto {
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => VariantAttributeDto)
  attributes: VariantAttributeDto[];
}

export class UpdateVariantDto {
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class CategoryDto {
  @IsString()
  @Length(2, 120)
  name: string;

  @Matches(SLUG)
  slug: string;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @Matches(URL_OR_PATH)
  imageUrl?: string | null;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(70)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(170)
  seoDescription?: string;
}
export class UpdateCategoryDto extends PartialType(CategoryDto) {}

export class BrandDto {
  @IsString()
  @Length(1, 120)
  name: string;

  @Matches(SLUG)
  slug: string;

  @IsOptional()
  @Matches(URL_OR_PATH)
  logoUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
export class UpdateBrandDto extends PartialType(BrandDto) {}

export class AttributeDto {
  @Matches(/^[a-z][a-z0-9_]*$/)
  code: string;

  @IsString()
  @Length(1, 80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string | null;

  @IsOptional()
  @IsBoolean()
  filterable?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
export class UpdateAttributeDto extends PartialType(AttributeDto) {}

// ── orders ──

export class AdminOrderQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(Object.values(OrderStatus))
  status?: OrderStatus;

  @IsOptional()
  @IsIn(['COURIER', 'PICKUP'])
  deliveryMethod?: 'COURIER' | 'PICKUP';

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class ChangeOrderStatusDto {
  @IsIn(Object.values(OrderStatus))
  status: OrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** Required when status is SHIPPED */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  trackingNumber?: string;

  @IsOptional()
  @IsUrl()
  trackingUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  courier?: string;
}

// ── customers ──

export class AdminCustomerQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['NONE', 'PENDING', 'APPROVED', 'REJECTED'])
  tradeStatus?: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
}

export class TradeDecisionDto {
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';
}

// ── content ──

export class PageDto {
  @Matches(SLUG)
  slug: string;

  @IsString()
  @Length(1, 200)
  title: string;

  @IsString()
  @MaxLength(100_000)
  body: string;

  @IsOptional()
  @IsIn(['page', 'blog'])
  kind?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  excerpt?: string;

  @IsOptional()
  @Matches(URL_OR_PATH)
  coverImageUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(70)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(170)
  seoDescription?: string;
}
export class UpdatePageDto extends PartialType(PageDto) {}

export class BannerDto {
  @IsIn(['home_hero', 'home_strip'])
  placement: string;

  @IsString()
  @Length(1, 120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  subtitle?: string;

  @IsOptional()
  @Matches(URL_OR_PATH)
  imageUrl?: string | null;

  @IsOptional()
  @Matches(URL_OR_PATH)
  linkUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  ctaLabel?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsISO8601()
  startsAt?: string | null;

  @IsOptional()
  @IsISO8601()
  endsAt?: string | null;
}
export class UpdateBannerDto extends PartialType(BannerDto) {}

// ── settings ──

export class CouponDto {
  @Transform(upper)
  @Matches(/^[A-Z0-9_-]{3,40}$/)
  code: string;

  @IsIn(Object.values(CouponType))
  type: CouponType;

  /** Percent (1-100) or fils */
  @IsInt()
  @Min(0)
  value: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minSubtotalFils?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number | null;

  @IsOptional()
  @IsISO8601()
  validFrom?: string | null;

  @IsOptional()
  @IsISO8601()
  validTo?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
export class UpdateCouponDto extends PartialType(CouponDto) {}

export class ShippingRateDto {
  @IsInt()
  @Min(0)
  baseFils: number;

  @IsInt()
  @Min(0)
  baseWeightKg: number;

  @IsInt()
  @Min(0)
  perKgFils: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  freeOverFils?: number | null;

  @IsInt()
  @Min(1)
  maxWeightKg: number;

  @IsInt()
  @Min(0)
  etaDays: number;

  @IsBoolean()
  active: boolean;
}

export class BranchDto {
  /** Must match the branch code in the POS */
  @Matches(/^[A-Z0-9_-]{2,20}$/)
  code: string;

  @IsString()
  @Length(2, 120)
  name: string;

  @IsIn(Object.values(Emirate))
  emirate: Emirate;

  @IsString()
  @Length(2, 300)
  address: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsNumber()
  lat?: number | null;

  @IsOptional()
  @IsNumber()
  lng?: number | null;

  @IsOptional()
  openingHours?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  pickupEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
export class UpdateBranchDto extends PartialType(BranchDto) {}

export class StaffDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email: string;

  @IsString()
  @Length(2, 120)
  name: string;

  @IsIn(Object.values(StaffRole))
  role: StaffRole;

  @IsString()
  @MinLength(10)
  password: string;
}

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsIn(Object.values(StaffRole))
  role?: StaffRole;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(10)
  password?: string;
}

export class ReportQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days: number = 30;
}
