import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ApiError } from '../api-error.js';
import type {
  AppRequest,
  CustomerPrincipal,
  StaffPrincipal,
} from '../auth.js';

/** The logged-in customer. Use with CustomerAuthGuard. */
export const CurrentCustomer = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): CustomerPrincipal => {
    const customer = ctx.switchToHttp().getRequest<AppRequest>().customer;
    if (!customer) throw ApiError.unauthorized();
    return customer;
  },
);

/** The customer if logged in, else undefined. Use with OptionalCustomerGuard. */
export const MaybeCustomer = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): CustomerPrincipal | undefined =>
    ctx.switchToHttp().getRequest<AppRequest>().customer,
);

/** The logged-in staff member. Use with StaffAuthGuard. */
export const CurrentStaff = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): StaffPrincipal => {
    const staff = ctx.switchToHttp().getRequest<AppRequest>().staff;
    if (!staff) throw ApiError.unauthorized();
    return staff;
  },
);
