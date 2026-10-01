import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const csv = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value.split(',').map((v) => v.trim()).filter(Boolean)
    : value;

export const PRODUCT_SORTS = ['relevance', 'newest', 'price_asc', 'price_desc', 'name'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export class ListProductsDto {
  @IsOptional()
  @IsString()
  category?: string;

  /** Comma separated brand slugs */
  @IsOptional()
  @Transform(csv)
  @IsString({ each: true })
  brand?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  /** VAT-inclusive AED */
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  minPrice?: number;

  /** VAT-inclusive AED */
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  inStock?: boolean;

  /** attr[size]=1/2",3/4" */
  @IsOptional()
  @IsObject()
  attr?: Record<string, string>;

  @IsOptional()
  @IsIn(PRODUCT_SORTS)
  sort?: ProductSort;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  pageSize: number = 24;
}
