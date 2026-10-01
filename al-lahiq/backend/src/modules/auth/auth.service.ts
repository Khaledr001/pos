import { HttpStatus, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { ApiError } from '../../common/api-error.js';
import type { Customer, StaffUser } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LoginDto, RegisterDto } from './dto/auth.dto.js';

export function toCustomerDto(c: Customer) {
  return {
    id: c.id,
    email: c.email,
    phone: c.phone,
    firstName: c.firstName,
    lastName: c.lastName,
    companyName: c.companyName,
    trn: c.trn,
    type: c.type,
    tradeStatus: c.tradeStatus,
  };
}

export function toStaffDto(s: StaffUser) {
  return { id: s.id, email: s.email, name: s.name, role: s.role, active: s.active };
}

// Verified against when the email is unknown, so response time doesn't reveal
// which emails are registered.
const DUMMY_HASH = await argon2.hash('not-a-real-password');

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  hashPassword(password: string) {
    return argon2.hash(password);
  }

  async registerCustomer(dto: RegisterDto) {
    const exists = await this.prisma.customer.findUnique({ where: { email: dto.email } });
    if (exists) {
      throw new ApiError(HttpStatus.CONFLICT, 'EMAIL_TAKEN', 'An account with this email already exists');
    }
    return this.prisma.customer.create({
      data: {
        email: dto.email,
        passwordHash: await this.hashPassword(dto.password),
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        projectLists: { create: { name: 'Wishlist', isWishlist: true } },
      },
    });
  }

  async validateCustomer(dto: LoginDto) {
    const customer = await this.prisma.customer.findUnique({ where: { email: dto.email } });
    const ok = await argon2.verify(customer?.passwordHash ?? DUMMY_HASH, dto.password);
    if (!customer || !ok) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    return customer;
  }

  async validateStaff(dto: LoginDto) {
    const staff = await this.prisma.staffUser.findUnique({ where: { email: dto.email } });
    const ok = await argon2.verify(staff?.passwordHash ?? DUMMY_HASH, dto.password);
    if (!staff || !ok || !staff.active) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    return staff;
  }

  async activeStaffRole(id: string) {
    const staff = await this.prisma.staffUser.findUnique({ where: { id } });
    return staff?.active ? staff.role : null;
  }

  async getCustomer(id: string) {
    const c = await this.prisma.customer.findUnique({ where: { id } });
    if (!c) throw ApiError.unauthorized();
    return c;
  }

  async getStaff(id: string) {
    const s = await this.prisma.staffUser.findUnique({ where: { id } });
    if (!s?.active) throw ApiError.unauthorized();
    return s;
  }
}
