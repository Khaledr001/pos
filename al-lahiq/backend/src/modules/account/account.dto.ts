import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { AddressDto } from '../checkout/dto/checkout.dto.js';

const strip = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[\s-]/g, '') : value;

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 60)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  lastName?: string;

  @IsOptional()
  @Transform(strip)
  @Matches(/^\+?971\d{8,9}$/, { message: 'phone must be a UAE number like +971501234567' })
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string;

  @IsOptional()
  @Transform(strip)
  @Matches(/^100\d{12}$/, { message: 'TRN must be 15 digits starting with 100' })
  trn?: string;
}

export class SaveAddressDto extends AddressDto {
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto extends PartialType(SaveAddressDto) {}

export class TradeApplicationDto {
  @IsString()
  @Length(2, 200)
  companyName: string;

  @Transform(strip)
  @Matches(/^100\d{12}$/, { message: 'TRN must be 15 digits starting with 100' })
  trn: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}

export class CreateListDto {
  @IsString()
  @Length(1, 80)
  name: string;
}

export class ListItemDto {
  @IsUUID()
  variantId: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  uom?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity?: number;
}
