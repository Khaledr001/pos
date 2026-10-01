import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Emirate, PaymentMethod } from '../../../generated/prisma/enums.js';

const EMIRATES = Object.values(Emirate);
const PAYMENT_METHODS = Object.values(PaymentMethod);
const UAE_PHONE = /^\+?971\d{8,9}$/;
const strip = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[\s-]/g, '') : value;

export class QuoteDto {
  @IsOptional()
  @IsIn(['COURIER', 'PICKUP'])
  deliveryMethod?: 'COURIER' | 'PICKUP';

  @IsOptional()
  @IsIn(EMIRATES)
  emirate?: Emirate;

  @IsOptional()
  @IsUUID()
  pickupBranchId?: string;
}

export class ContactDto {
  @IsString()
  @Length(2, 120)
  fullName: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email: string;

  @Transform(strip)
  @Matches(UAE_PHONE, { message: 'phone must be a UAE number like +971501234567' })
  phone: string;
}

export class AddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  @IsString()
  @Length(2, 120)
  fullName: string;

  @Transform(strip)
  @Matches(UAE_PHONE, { message: 'phone must be a UAE number like +971501234567' })
  phone: string;

  @IsIn(EMIRATES)
  emirate: Emirate;

  @IsString()
  @Length(2, 120)
  area: string;

  @IsString()
  @Length(2, 200)
  street: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  building?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  landmark?: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;
}

export class PlaceOrderDto {
  @IsIn(['COURIER', 'PICKUP'])
  deliveryMethod: 'COURIER' | 'PICKUP';

  @ValidateNested()
  @Type(() => ContactDto)
  contact: ContactDto;

  /** Required for courier delivery (or addressId for a saved address). */
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @IsOptional()
  @IsUUID()
  addressId?: string;

  @IsOptional()
  @IsBoolean()
  saveAddress?: boolean;

  @IsOptional()
  @IsUUID()
  pickupBranchId?: string;

  @IsOptional()
  @IsISO8601()
  pickupSlotStart?: string;

  @IsIn(PAYMENT_METHODS)
  paymentMethod: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string;

  /** UAE Tax Registration Number: 15 digits starting with 100 */
  @IsOptional()
  @Transform(strip)
  @Matches(/^100\d{12}$/, { message: 'TRN must be 15 digits starting with 100' })
  trn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** Total the customer saw; if it differs the order is not placed. */
  @IsOptional()
  @IsInt()
  expectedTotalFils?: number;
}
