import { eq, schema, type ShopperAccount, type Transaction } from "@devsfleet/db";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import bcrypt from "bcryptjs";
import type { Env } from "../../../config/env.js";
import { RequestContext } from "../../../common/context/request-context.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import { CartService } from "../cart/cart.service.js";
import { requireShopper } from "../context/storefront.guard.js";
import { ShopperTokens, type IssuedShopperTokens } from "../context/shopper-tokens.service.js";
import { toWire } from "../wire.js";
import type { LoginDto, RegisterDto } from "./dto.js";

/** What a page knows about the signed-in shopper. */
export function toCustomerView(account: ShopperAccount, customerType: string) {
  return {
    id: account.id,
    email: account.email,
    phone: account.phone,
    firstName: account.firstName,
    lastName: account.lastName,
    companyName: account.companyName,
    trn: account.trn,
    // A wholesale or VIP customer at the counter is a trade customer online.
    type: customerType === "retail" ? ("RETAIL" as const) : ("TRADE" as const),
    tradeStatus: toWire(account.tradeStatus),
  };
}

@Injectable()
export class ShopperAuthService {
  private readonly rounds: number;
  /** Compared against when the email is unknown, so timing does not reveal which emails have accounts. */
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly db: TenantDatabase,
    private readonly tokens: ShopperTokens,
    private readonly carts: CartService,
    config: ConfigService<Env, true>,
  ) {
    this.rounds = config.get("BCRYPT_ROUNDS", { infer: true });
    this.dummyHash = bcrypt.hash("devsfleet-storefront-timing-dummy", this.rounds);
  }

  /**
   * A new shopper, backed by a NEW customers row.
   *
   * Never linked to an existing POS customer with the same email or phone:
   * typing someone else's email would otherwise inherit their trade price
   * list and their credit. Staff merge the two in the admin panel once the
   * person is known — the same way a trade application is approved.
   */
  async register(dto: RegisterDto, guestCartId: string | undefined) {
    const passwordHash = await bcrypt.hash(dto.password, this.rounds);
    return this.db.run(async (tx) => {
      const tenantId = RequestContext.requireTenantId();
      const taken = await tx.query.shopperAccounts.findFirst({
        where: (t, { eq: e }) => e(t.email, dto.email),
        columns: { id: true },
      });
      if (taken) {
        throw new AppError(ERROR_CODES.DUPLICATE_EMAIL, "An account with this email already exists. Sign in instead.");
      }

      const [customer] = await tx
        .insert(schema.customers)
        .values({
          tenantId,
          name: `${dto.firstName} ${dto.lastName}`,
          email: dto.email,
          phone: dto.phone ?? null,
          notes: "Registered on the online store.",
        })
        .returning({ id: schema.customers.id, type: schema.customers.type });

      const [account] = await tx
        .insert(schema.shopperAccounts)
        .values({
          tenantId,
          customerId: customer!.id,
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone ?? null,
          lastLoginAt: new Date(),
        })
        .returning();

      await this.carts.adoptGuestCart(tx, guestCartId, account!.id);
      const tokens = await this.tokens.issue(tx, { accountId: account!.id, customerId: customer!.id, tenantId });
      return { customer: toCustomerView(account!, customer!.type), tokens };
    });
  }

  async login(dto: LoginDto, guestCartId: string | undefined) {
    return this.db.run(async (tx) => {
      const tenantId = RequestContext.requireTenantId();
      const account = await tx.query.shopperAccounts.findFirst({ where: (t, { eq: e }) => e(t.email, dto.email) });

      const valid = account
        ? await bcrypt.compare(dto.password, account.passwordHash)
        : (await bcrypt.compare(dto.password, await this.dummyHash), false);
      if (!account || !valid) {
        throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, "That email and password do not match.");
      }
      if (!account.isActive) {
        throw new AppError(ERROR_CODES.ACCOUNT_DISABLED, "This account has been closed. Contact the shop.");
      }

      await tx.update(schema.shopperAccounts).set({ lastLoginAt: new Date() }).where(eq(schema.shopperAccounts.id, account.id));
      await this.carts.adoptGuestCart(tx, guestCartId, account.id);
      const tokens = await this.tokens.issue(tx, { accountId: account.id, customerId: account.customerId, tenantId });
      return { customer: toCustomerView(account, await this.customerType(tx, account.customerId)), tokens };
    });
  }

  async refresh(refreshToken: string | undefined): Promise<IssuedShopperTokens> {
    if (!refreshToken) throw new AppError(ERROR_CODES.SHOPPER_AUTH_REQUIRED, "Sign in to continue.");
    const tenantId = RequestContext.requireTenantId();
    // RLS already confines the lookup to this tenant's sessions, so another
    // shop's refresh token simply is not found here.
    const outcome = await this.db.run((tx) => this.tokens.rotate(tx, refreshToken));
    if ("refused" in outcome) throw new AppError(ERROR_CODES.SHOPPER_AUTH_REQUIRED, outcome.refused);
    if (outcome.principal.tenantId !== tenantId) {
      throw new AppError(ERROR_CODES.SHOPPER_AUTH_REQUIRED, "Sign in to continue.");
    }
    return outcome.tokens;
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.db.run((tx) => this.tokens.revoke(tx, refreshToken));
  }

  async me() {
    const shopper = requireShopper();
    return this.db.run(async (tx) => {
      const account = await tx.query.shopperAccounts.findFirst({ where: (t, { eq: e }) => e(t.id, shopper.accountId) });
      if (!account?.isActive) throw new AppError(ERROR_CODES.SHOPPER_AUTH_REQUIRED, "Sign in to continue.");
      return toCustomerView(account, await this.customerType(tx, account.customerId));
    });
  }

  private async customerType(tx: Transaction, customerId: string): Promise<string> {
    const customer = await tx.query.customers.findFirst({
      where: (t, { eq: e }) => e(t.id, customerId),
      columns: { type: true },
    });
    return customer?.type ?? "retail";
  }
}
