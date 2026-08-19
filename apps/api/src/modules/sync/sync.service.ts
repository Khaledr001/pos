import { and, eq, isNull, or, schema, sql } from "@devsfleet/db";
import type {
  SyncPullChange,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  SyncPushResult,
} from "@devsfleet/shared-types";
import { hasPermission, resolveTenantSettings, type Permission } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { CashMovementSchema, OpenSessionSchema } from "../cash-register/dto.js";
import { CashRegisterService } from "../cash-register/cash-register.service.js";
import { CreateSaleSchema } from "../sales/dto.js";
import { SalesService } from "../sales/sales.service.js";
import { CustomersService } from "../customers/customers.service.js";
import { QuotationsService } from "../quotations/quotations.service.js";
import { CreateCustomerSchema, RecordPaymentSchema } from "../customers/dto.js";
import { CreateQuotationSchema } from "../quotations/dto.js";

/**
 * The POS sync engine, server side.
 *
 * Implements the contract in @devsfleet/shared-types/sync.ts. That file is the
 * specification for BOTH ends, so nothing here may invent a field the terminal
 * does not know about.
 *
 * Two properties carry the whole design:
 *
 *   PUSH is idempotent. Every item carries the `localId` the terminal minted
 *   when the record was created, and it is resent unchanged on every attempt.
 *   A retry after a timeout therefore cannot double-book a sale.
 *
 *   PULL is a high-water mark, not a diff. The terminal stores the checkpoint
 *   the server returns and sends it back next time. Deletes travel as
 *   tombstones, because a row that simply stopped appearing in a result set is
 *   indistinguishable from one that was never sent.
 */
/**
 * One entity's high-water mark: the last (updated_at, id) the terminal holds.
 *
 * `at` is the RAW Postgres timestamp text, not a JS Date, and that is the whole
 * point. `timestamptz` keeps microseconds; a JS Date only has milliseconds, so
 * round-tripping through `toISOString()` truncates `15:42:56.117434` to
 * `15:42:56.117`. The mark then sits permanently *behind* the row it was taken
 * from, the `>` predicate matches that row again, and every pull re-sends the
 * entire catalogue forever without ever converging.
 *
 * Carrying the value as text preserves it exactly, and Postgres parses it back
 * at full precision on the way in.
 */
interface Mark {
  at: string;
  id: string;
}

const EPOCH: Mark = {
  at: "1970-01-01T00:00:00Z",
  id: "00000000-0000-0000-0000-000000000000",
};

/**
 * What each pushable entity costs, mirroring the permission its own HTTP route
 * declares. Keep this table in step with those controllers — a new push entity
 * without an entry here silently inherits the route's `sale:create` and nothing
 * more.
 */
const PUSH_PERMISSIONS: Partial<
  Record<SyncPushRequest["items"][number]["entity"], Permission[]>
> = {
  sale: ["sale:create"],
  cash_session: ["cash:open"],
  cash_movement: ["cash:movement"],
  customer: ["customer:write"],
  quotation: ["quotation:write"],
  customer_payment: ["customer:credit"],
};

/**
 * Entities on the way DOWN that need more than the route's `product:read`.
 *
 * Anything absent here is catalogue data every till needs to sell — products,
 * prices, units, categories — and is covered by the route's own permission.
 */
const PULL_PERMISSIONS: Record<string, Permission> = {
  customer: "customer:read",
  inventory: "inventory:read",
  /**
   * `user` is deliberately ABSENT here, not merely permissive.
   *
   * This entity is the staff directory a terminal needs to verify a PIN with
   * no network at all — every cashier signing in offline depends on it having
   * already been pulled, by WHICHEVER token the device happens to be
   * authenticated as at the time. Gating it on `user:read` would mean a
   * device whose stored session belongs to a plain cashier (who does not hold
   * it) could never pull the very data that lets OTHER cashiers sign in
   * offline — the feature would work only at branches where a manager
   * happened to be the last one to sign in online. Every role needs this,
   * the same way every role needs the catalogue.
   */
};

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  /**
   * Rows per entity per page.
   *
   * Deliberately modest. A terminal on a shop DSL line pulling a 5,000-SKU
   * catalogue wants many small responses it can resume, not one large one that
   * times out at 90% and starts again.
   */
  private readonly PAGE = 500;

  constructor(
    private readonly db: TenantDatabase,
    private readonly sales: SalesService,
    private readonly cash: CashRegisterService,
    private readonly customers: CustomersService,
    private readonly quotations: QuotationsService,
  ) {}

  /**
   * Accept everything a terminal created while it was away.
   *
   * Items are applied in `sequence` order, because a sale that references a
   * cash session created moments earlier must not arrive first. One item
   * failing does not abort the batch — it is reported and the rest continue,
   * or a single bad record would block a whole day's takings behind it.
   */
  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    const device = await this.requireDevice(request.deviceId);
    const results: SyncPushResult[] = [];

    const ordered = [...request.items].sort((a, b) => a.sequence - b.sequence);

    for (const item of ordered) {
      try {
        results.push(await this.applyItem(item, device.branchId));
      } catch (error) {
        const isBusiness = error instanceof AppError;

        /**
         * A business rejection is permanent — retrying an over-limit credit
         * sale forever will never succeed, so the terminal must stop and show
         * a human. Anything else is treated as transient and retried.
         */
        results.push({
          localId: item.localId,
          outcome: isBusiness ? "rejected" : "deferred",
          code: isBusiness ? (error as AppError).code : ERROR_CODES.INTERNAL_ERROR,
          message:
            error instanceof Error ? error.message : "Could not apply this record",
        });

        this.logger.warn(
          { localId: item.localId, entity: item.entity, deviceId: request.deviceId },
          `Push item ${isBusiness ? "rejected" : "deferred"}`,
        );
      }
    }

    await this.db.run(async (tx) => {
      await tx
        .update(schema.devices)
        .set({ lastSyncAt: new Date(), lastSeenAt: new Date() })
        .where(eq(schema.devices.id, request.deviceId));
    });

    return {
      results,
      // Push does not advance the pull checkpoint — they track different things.
      checkpoint: request.lastCheckpoint ?? "",
      serverTime: new Date().toISOString(),
    };
  }

  /**
   * Everything that changed since the terminal's checkpoint.
   *
   * Entity order matters on the way down: a variant's price is useless without
   * the variant, and a variant is useless without its product. The terminal
   * applies them in the order returned.
   */
  async pull(request: SyncPullRequest): Promise<SyncPullResponse> {
    const device = await this.requireDevice(request.deviceId);
    /**
     * A high-water mark PER ENTITY, not one shared across all of them.
     *
     * Entities are unrelated timelines. Rows written in a single transaction
     * share one `updated_at`, so a keyset of (timestamp, uuid) taken from the
     * last entity processed says nothing useful about another entity whose ids
     * sort arbitrarily around it — roughly half its rows come back on every
     * subsequent pull, forever on a catalogue that is regularly edited.
     *
     * The checkpoint stays opaque to the terminal, so carrying a map inside it
     * costs nothing at the contract level.
     */
    const marks = this.decodeCheckpoint(request.since);
    const limit = Math.min(request.limit ?? this.PAGE, this.PAGE);

    const changes: SyncPullChange[] = [];
    let hasMore = false;

    /**
     * The tenant's tax defaults travel with the catalogue.
     *
     * `products.tax_rate` is nullable, meaning "use the tenant default" — a
     * fallback the terminal has no way to know. Sending the raw null makes an
     * offline receipt total 23.31 where the server's invoice says 24.48, and
     * the customer is holding the wrong one. The rate is resolved here, once,
     * so the terminal never has to guess.
     */
    const settings = await this.db.run(async (tx) => {
      const tenant = await tx.query.tenants.findFirst({ columns: { settings: true } });
      return resolveTenantSettings(tenant?.settings);
    });
    const defaultTaxRate = String(settings.tax.defaultRate);

    /**
     * Wanted by the terminal AND permitted to this principal.
     *
     * The route is gated on `product:read`, which is right for the catalogue
     * but not for everything pull can return. Asking for `entities:
     * ["customer"]` used to hand back the whole customer list — names, phones,
     * TRNs, credit balances — to any role that could read a product. The
     * warehouse role is exactly that: `product:read` and `inventory:read`, and
     * deliberately no `customer:read`.
     */
    const user = RequestContext.requireUser();
    const wanted = (entity: string) => {
      if (request.entities && !request.entities.includes(entity as never)) return false;

      const required = PULL_PERMISSIONS[entity];
      return !required || hasPermission(user.permissions, required);
    };

    await this.db.run(async (tx) => {
      /**
       * Keyset pagination on (updated_at, id).
       *
       * Paging on the timestamp alone would silently skip rows whenever a batch
       * boundary fell in the middle of a group sharing one `updated_at` — which
       * a bulk price update produces by the thousand.
       */
      const after = (entity: string, table: { updatedAt: unknown; id: unknown }) => {
        const mark = marks[entity] ?? EPOCH;
        return sql`(${table.updatedAt}, ${table.id}) > (${mark.at}::timestamptz, ${mark.id}::uuid)`;
      };

      /**
       * Rows arrive ordered by (updated_at, id), so the LAST row is the new
       * high-water mark. Taking it positionally rather than recomputing a
       * maximum in JavaScript avoids comparing a truncated Date against a
       * full-precision one.
       */
      const collect = <T extends { id: string; updatedAt: Date; updatedAtRaw: string }>(
        entity: SyncPullChange["entity"],
        rows: T[],
        toRecord: (row: T) => unknown,
        isDeleted: (row: T) => boolean,
      ) => {
        if (rows.length >= limit) hasMore = true;

        for (const row of rows) {
          const { updatedAtRaw: _raw, ...record } = row as T & Record<string, unknown>;
          changes.push({
            entity,
            id: row.id,
            deleted: isDeleted(row),
            updatedAt: row.updatedAt.toISOString(),
            // A tombstone carries no body — the terminal only needs to forget it.
            ...(isDeleted(row) ? {} : { record: toRecord(record as T) }),
          });
        }

        const last = rows.at(-1);
        if (last) marks[entity] = { at: last.updatedAtRaw, id: last.id };
      };

      if (wanted("unit")) {
        const rows = await tx
          .select({
            id: schema.units.id,
            updatedAt: schema.units.updatedAt,
            updatedAtRaw: sql<string>`units.updated_at::text`,
            name: schema.units.name,
            abbreviation: schema.units.abbreviation,
            allowsFractions: schema.units.allowsFractions,
          })
          .from(schema.units)
          .where(after("unit", schema.units))
          .orderBy(schema.units.updatedAt, schema.units.id)
          .limit(limit);
        collect("unit", rows, (r) => r, () => false);
      }

      if (wanted("category")) {
        const rows = await tx
          .select({
            id: schema.categories.id,
            updatedAt: schema.categories.updatedAt,
            updatedAtRaw: sql<string>`categories.updated_at::text`,
            deletedAt: schema.categories.deletedAt,
            parentId: schema.categories.parentId,
            name: schema.categories.name,
            slug: schema.categories.slug,
            path: schema.categories.path,
            depth: schema.categories.depth,
            sortOrder: schema.categories.sortOrder,
            isActive: schema.categories.isActive,
          })
          .from(schema.categories)
          .where(after("category", schema.categories))
          .orderBy(schema.categories.updatedAt, schema.categories.id)
          .limit(limit);
        collect("category", rows, (r) => r, (r) => r.deletedAt !== null);
      }

      if (wanted("product")) {
        // The terminal sells VARIANTS, so this carries the variant joined to
        // the product fields it needs to display and price a line.
        const rows = await tx
          .select({
            id: schema.productVariants.id,
            updatedAt: schema.productVariants.updatedAt,
            updatedAtRaw: sql<string>`product_variants.updated_at::text`,
            deletedAt: schema.productVariants.deletedAt,
            isActive: schema.productVariants.isActive,
            sku: schema.productVariants.sku,
            barcode: schema.productVariants.barcode,
            variantName: schema.productVariants.variantName,
            searchKey: schema.productVariants.searchKey,
            minStock: schema.productVariants.minStock,
            productId: schema.products.id,
            productName: schema.products.name,
            taxRate: schema.products.taxRate,
            isStockTracked: schema.products.isStockTracked,
            unitAbbr: schema.units.abbreviation,
            categoryName: schema.categories.name,
          })
          .from(schema.productVariants)
          .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
          .innerJoin(schema.units, eq(schema.products.unitId, schema.units.id))
          .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
          .where(after("product", schema.productVariants))
          .orderBy(schema.productVariants.updatedAt, schema.productVariants.id)
          .limit(limit);

        collect(
          "product",
          rows,
          (r) => ({ ...r, taxRate: r.taxRate ?? defaultTaxRate, taxMode: settings.tax.mode }),
          // A deactivated variant is a tombstone too: the till must stop
          // offering it, and it has no other way to learn that.
          (r) => r.deletedAt !== null || !r.isActive,
        );
      }

      if (wanted("product_price")) {
        const rows = await tx
          .select({
            id: schema.productPrices.id,
            updatedAt: schema.productPrices.updatedAt,
            updatedAtRaw: sql<string>`product_prices.updated_at::text`,
            variantId: schema.productPrices.variantId,
            priceListId: schema.productPrices.priceListId,
            sellingPrice: schema.productPrices.sellingPrice,
            minSellingPrice: schema.productPrices.minSellingPrice,
            effectiveTo: schema.productPrices.effectiveTo,
            /**
             * Without this the terminal holds several prices per variant and
             * no rule for choosing between them — it would show whichever row
             * the join happened to return, which is a different price on two
             * tills looking at the same product.
             */
            isDefault: schema.priceLists.isDefault,
          })
          .from(schema.productPrices)
          .innerJoin(
            schema.priceLists,
            eq(schema.productPrices.priceListId, schema.priceLists.id),
          )
          .where(and(after("product_price", schema.productPrices), isNull(schema.productPrices.effectiveTo)))
          .orderBy(schema.productPrices.updatedAt, schema.productPrices.id)
          .limit(limit);
        // Cost is absent by construction — a terminal has no use for it and a
        // stolen one should not carry margin data.
        collect("product_price", rows, (r) => r, () => false);
      }

      if (wanted("customer")) {
        const rows = await tx
          .select({
            id: schema.customers.id,
            updatedAt: schema.customers.updatedAt,
            updatedAtRaw: sql<string>`customers.updated_at::text`,
            deletedAt: schema.customers.deletedAt,
            name: schema.customers.name,
            company: schema.customers.company,
            phone: schema.customers.phone,
            trn: schema.customers.trn,
            priceListId: schema.customers.priceListId,
            creditLimit: schema.customers.creditLimit,
            creditBalance: schema.customers.creditBalance,
            creditOnHold: schema.customers.creditOnHold,
          })
          .from(schema.customers)
          .where(after("customer", schema.customers))
          .orderBy(schema.customers.updatedAt, schema.customers.id)
          .limit(limit);
        collect("customer", rows, (r) => r, (r) => r.deletedAt !== null);
      }

      if (wanted("inventory")) {
        // Only this terminal's own branch. Stock elsewhere is not its business
        // and would triple the payload for a multi-branch tenant.
        const rows = await tx
          .select({
            id: schema.inventory.id,
            updatedAt: schema.inventory.updatedAt,
            updatedAtRaw: sql<string>`inventory.updated_at::text`,
            variantId: schema.inventory.variantId,
            quantity: schema.inventory.quantity,
            reservedQuantity: schema.inventory.reservedQuantity,
          })
          .from(schema.inventory)
          .where(
            and(after("inventory", schema.inventory), eq(schema.inventory.branchId, device.branchId)),
          )
          .orderBy(schema.inventory.updatedAt, schema.inventory.id)
          .limit(limit);
        collect("inventory", rows, (r) => r, () => false);
      }

      if (wanted("user")) {
        /**
         * The staff a terminal at THIS branch can ever sign in offline —
         * branch-scoped users, plus tenant-wide ones (`branchId IS NULL`:
         * owners, area managers), matching exactly who `resolvePinHolder`
         * considers for an online PIN login at this branch. A user with no
         * PIN set is included rather than filtered out here — they cannot
         * sign in either way, and filtering them would mean assigning them
         * one later never produces a tombstone-free "new row" the terminal
         * has not seen, since it never appeared in the first place.
         *
         * `passwordHash` never appears here — PIN login never needed it, and
         * a stolen terminal should not be a shortcut to the admin panel too.
         */
        const rows = await tx
          .select({
            id: schema.users.id,
            updatedAt: schema.users.updatedAt,
            updatedAtRaw: sql<string>`users.updated_at::text`,
            deletedAt: schema.users.deletedAt,
            isActive: schema.users.isActive,
            branchId: schema.users.branchId,
            name: schema.users.name,
            pinHash: schema.users.pinHash,
            maxDiscountPercent: schema.users.maxDiscountPercent,
            roleName: schema.roles.name,
            permissions: schema.roles.permissions,
          })
          .from(schema.users)
          .innerJoin(schema.roles, eq(schema.users.roleId, schema.roles.id))
          .where(
            and(
              after("user", schema.users),
              or(eq(schema.users.branchId, device.branchId), isNull(schema.users.branchId)),
            ),
          )
          .orderBy(schema.users.updatedAt, schema.users.id)
          .limit(limit);

        collect(
          "user",
          rows,
          (r) => r,
          // Deactivating a cashier must reach the till: an offline sign-in
          // has no other way to learn their access was withdrawn.
          (r) => r.deletedAt !== null || !r.isActive,
        );
      }
    });

    return {
      changes,
      checkpoint: this.encodeCheckpoint(marks),
      hasMore,
      serverTime: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------

  private async applyItem(
    item: SyncPushRequest["items"][number],
    branchId: string,
  ): Promise<SyncPushResult> {
    // The contract types this `unknown` on purpose — a terminal on an older
    // build can send anything, and `parsePayload` is what decides it is a sale.
    const payload = (item.payload ?? {}) as Record<string, unknown>;

    this.assertMayPush(item.entity);

    switch (item.entity) {
      case "sale": {
        /**
         * Distinguish a first application from a retry.
         *
         * `sales.create` is idempotent and quietly returns the original, which
         * is correct — but the terminal needs to know which happened. It clears
         * an item from its outbox on either, and reports "already uploaded"
         * rather than "sold" on a duplicate. Reporting every retry as `applied`
         * would make a resend look like a second sale in the terminal's log.
         */
        const known = await this.db.run(async (tx) =>
          tx.query.sales.findFirst({
            where: (t, { eq: e }) => e(t.localId, item.localId),
            columns: { id: true, saleNumber: true },
          }),
        );
        if (known) {
          return {
            localId: item.localId,
            outcome: "duplicate",
            serverId: known.id,
            documentNumber: known.saleNumber,
          };
        }

        /**
         * The drawer this sale was rung up against was opened OFFLINE, so the
         * payload names it by the terminal's own id. Items are applied in
         * sequence order, so the session exists by now — but under the id the
         * server assigned it, not the one the terminal knows.
         */
        const session = await this.resolveCashSession(payload.cashSessionId);

        // Server-owned fields are stamped BEFORE validation, so the schema sees
        // the shape the service will actually receive. Branch, idempotency key
        // and origin are never the terminal's to choose.
        const dto = this.parsePayload(CreateSaleSchema, "sale", {
          ...payload,
          cashSessionId: session,
          branchId,
          localId: item.localId,
          occurredAt: item.occurredAt,
          source: "pos",
        });

        const sale = (await this.sales.create(dto)) as {
          id: string;
          saleNumber: string;
          dueAmount: string;
        };

        /**
         * A sale whose drawer could not be found is still a sale.
         *
         * Rejecting it would discard takings because a piece of metadata went
         * missing; the warning tells the terminal to show it as uploaded but
         * unreconciled, which is a question for a manager rather than a lost
         * invoice.
         */
        const detached = payload.cashSessionId != null && session === null;

        return {
          localId: item.localId,
          outcome: detached ? "applied_with_warning" : "applied",
          serverId: sale.id,
          documentNumber: sale.saleNumber,
          ...(detached
            ? { message: "Uploaded, but the drawer session it belonged to was not found" }
            : {}),
        };
      }

      case "cash_session": {
        const dto = this.parsePayload(
          OpenSessionSchema.extend({
            /**
             * The close travels inside the open, not as a second item. Two
             * items can be split across batches, and a drawer that closed at
             * 8pm would stay open on the server overnight.
             */
            closedAt: z.string().datetime().optional(),
            countedAmount: z.coerce.number().min(0).optional(),
          }),
          "cash_session",
          {
            ...payload,
            branchId,
            localId: item.localId,
            openedAt: (payload.openedAt as string | undefined) ?? item.occurredAt,
          },
        );

        const session = (await this.cash.open(dto)) as {
          id: string;
          sessionNumber: string;
          status: string;
        };

        if (dto.closedAt && session.status === "open") {
          await this.cash.close(session.id, {
            countedAmount: dto.countedAmount ?? 0,
            ...(dto.notes ? { notes: dto.notes } : {}),
          });
        }

        return {
          localId: item.localId,
          outcome: "applied",
          serverId: session.id,
          documentNumber: session.sessionNumber,
        };
      }

      case "cash_movement": {
        const { cashSessionId, ...body } = this.parsePayload(
          CashMovementSchema.extend({ cashSessionId: z.string().uuid() }),
          "cash_movement",
          payload,
        );

        // Unlike a sale, a movement IS its drawer link — cash that moved
        // through no drawer is not a record anyone can reconcile.
        const session = await this.resolveCashSession(cashSessionId);
        if (!session) {
          throw new AppError(
            ERROR_CODES.NOT_FOUND,
            "The drawer session this movement belongs to was not found",
          );
        }

        const movement = (await this.cash.recordMovement(session, body)) as { id: string };

        return { localId: item.localId, outcome: "applied", serverId: movement.id };
      }
      case "customer": {
        const known = await this.db.run(async (tx) =>
          tx.query.customers.findFirst({
            where: (t, { eq: e }) => e(t.localId, item.localId),
            columns: { id: true },
          }),
        );
        if (known) {
          return {
            localId: item.localId,
            outcome: "duplicate",
            serverId: known.id,
          };
        }

        const dto = this.parsePayload(CreateCustomerSchema, "customer", {
          ...payload,
          branchId,
          localId: item.localId,
          occurredAt: item.occurredAt,
        });

        const customer = (await this.customers.create(dto)) as { id: string };

        return {
          localId: item.localId,
          outcome: "applied",
          serverId: customer.id,
        };
      }

      case "quotation": {
        const known = await this.db.run(async (tx) =>
          tx.query.quotations.findFirst({
            where: (t, { eq: e }) => e(t.localId, item.localId),
            columns: { id: true, quotationNumber: true },
          }),
        );
        if (known) {
          return {
            localId: item.localId,
            outcome: "duplicate",
            serverId: known.id,
            documentNumber: known.quotationNumber,
          };
        }

        const dto = this.parsePayload(CreateQuotationSchema, "quotation", {
          ...payload,
          branchId,
          localId: item.localId,
          occurredAt: item.occurredAt,
        });

        const quotation = (await this.quotations.create(dto)) as { id: string; quotationNumber: string };

        return {
          localId: item.localId,
          outcome: "applied",
          serverId: quotation.id,
          documentNumber: quotation.quotationNumber,
        };
      }

      case "customer_payment": {
        const known = await this.db.run(async (tx) =>
          tx.query.customerPayments.findFirst({
            where: (t, { eq: e }) => e(t.localId, item.localId),
            columns: { id: true },
          }),
        );
        if (known) {
          return { localId: item.localId, outcome: "duplicate", serverId: known.id };
        }

        // Same translation sales and cash_movement already do: the terminal
        // names the drawer by the id it minted offline, not the server's.
        const rawCashSessionId = payload.cashSessionId;
        const session = await this.resolveCashSession(rawCashSessionId);

        const { customerId, ...body } = this.parsePayload(
          RecordPaymentSchema.extend({ customerId: z.string().uuid() }),
          "customer_payment",
          {
            ...payload,
            // The POS's local field is `reference`; the schema's is
            // `referenceNumber`. Accepting either means a terminal on an
            // older build still gets its reference number through, instead
            // of it being silently dropped by a key the payload never had.
            referenceNumber: payload.referenceNumber ?? payload.reference,
            branchId,
            ...(session ? { cashSessionId: session } : { cashSessionId: undefined }),
            localId: item.localId,
            occurredAt: item.occurredAt,
          },
        );

        const payment = (await this.customers.recordPayment(customerId, body)) as { id: string };

        // Same posture as a sale whose drawer cannot be found: the cash was
        // genuinely received, so the payment still lands. It just cannot be
        // reconciled to any till, and a manager needs to know that.
        const detached = rawCashSessionId != null && session === null;

        return {
          localId: item.localId,
          outcome: detached ? "applied_with_warning" : "applied",
          serverId: payment.id,
          ...(detached
            ? { message: "Uploaded, but the drawer session it belonged to was not found" }
            : {}),
        };
      }

      default:
        /**
         * A terminal must never push catalogue data. The catalogue flows one
         * way, down, so two tills can never disagree about what something
         * costs.
         */
        return {
          localId: item.localId,
          outcome: "rejected",
          code: ERROR_CODES.SYNC_PAYLOAD_INVALID,
          message: `A terminal cannot push "${item.entity}" — that data only travels down.`,
        };
    }
  }

  /**
   * A pushed item needs the same permission its HTTP route would.
   *
   * `POST /sync/push` is gated on `sale:create` alone, because that is what a
   * till mostly does. But push also opens and closes cash drawers, records
   * drawer movements, creates customers and quotations, and — the sharp one —
   * takes a payment against a customer's credit account, which
   * `POST /customers/:id/payments` reserves for `customer:credit`.
   *
   * Without this, every one of those actions was reachable with `sale:create`:
   * the offline path was a strictly weaker gate than the online one, so the way
   * to bypass a permission was to route around it through sync.
   */
  private assertMayPush(entity: SyncPushRequest["items"][number]["entity"]): void {
    const required = PUSH_PERMISSIONS[entity];
    if (!required) return;

    const user = RequestContext.requireUser();
    const missing = required.filter((permission) => !hasPermission(user.permissions, permission));

    if (missing.length > 0) {
      throw new AppError(
        ERROR_CODES.INSUFFICIENT_PERMISSIONS,
        `Uploading a ${entity.replace("_", " ")} needs: ${missing.join(", ")}`,
      );
    }
  }

  /**
   * Validate a pushed payload with the same schema the HTTP route uses.
   *
   * The classification is the point. A malformed item that reaches the service
   * throws a TypeError, which `push()` reads as infrastructure and reports as
   * `deferred` — so the terminal keeps the item in its outbox and re-pushes it
   * on every sync, forever. Turning it into an `AppError` makes the outcome
   * `rejected`: permanent, surfaced to the cashier, and out of the queue.
   */
  private parsePayload<T extends z.ZodType>(
    schema: T,
    entity: string,
    payload: unknown,
  ): z.infer<T> {
    const parsed = schema.safeParse(payload);
    if (parsed.success) return parsed.data;

    const [first] = parsed.error.issues;
    throw new AppError(
      ERROR_CODES.SYNC_PAYLOAD_INVALID,
      `This ${entity.replace("_", " ")} cannot be uploaded: ${
        first ? `${first.path.join(".") || "payload"} — ${first.message}` : "malformed payload"
      }`,
      { issues: parsed.error.issues },
    );
  }

  /**
   * Map a terminal's drawer reference onto the server's id.
   *
   * Offline records name each other by the `localId` the terminal minted, so
   * a reference is checked against both: the server id when the terminal has
   * already been told it, and the client id when this is the first push.
   */
  private async resolveCashSession(reference: unknown): Promise<string | null> {
    if (typeof reference !== "string" || reference.length === 0) return null;

    return this.db.run(async (tx) => {
      const session = await tx.query.cashSessions.findFirst({
        where: (t, { eq: e, or: o }) => o(e(t.id, reference), e(t.localId, reference)),
        columns: { id: true },
      });
      return session?.id ?? null;
    });
  }

  private async requireDevice(deviceId: string) {
    const device = await this.db.run(async (tx) =>
      tx.query.devices.findFirst({
        where: (t, { and: a, eq: e }) => a(e(t.id, deviceId), e(t.isActive, true)),
      }),
    );

    if (!device) {
      throw new AppError(
        ERROR_CODES.DEVICE_NOT_REGISTERED,
        "This terminal is not registered, or has been deactivated",
      );
    }
    return device;
  }

  /**
   * The checkpoint is opaque to the client — it stores and returns it without
   * interpreting it. Encoding both halves of the keyset here means the paging
   * rule can change later without a terminal update.
   */
  private encodeCheckpoint(marks: Record<string, Mark>): string {
    const flat: Record<string, string> = {};
    for (const [entity, mark] of Object.entries(marks)) {
      flat[entity] = `${mark.at}|${mark.id}`;
    }
    return Buffer.from(JSON.stringify(flat)).toString("base64url");
  }

  private decodeCheckpoint(raw: string | null): Record<string, Mark> {
    if (!raw) return {};

    try {
      const flat = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as
        | Record<string, string>
        | null;
      if (!flat || typeof flat !== "object") return {};

      const marks: Record<string, Mark> = {};
      for (const [entity, value] of Object.entries(flat)) {
        // Split on the LAST separator: a Postgres timestamp contains no "|",
        // but splitting from the left would still be the fragile choice.
        const raw = String(value);
        const cut = raw.lastIndexOf("|");
        if (cut < 1) continue;

        const at = raw.slice(0, cut);
        const id = raw.slice(cut + 1);
        // Kept as text, at full microsecond precision. Validated only enough
        // that a malformed value cannot reach the query as a cast.
        if (at && id && !Number.isNaN(new Date(at).getTime())) marks[entity] = { at, id };
      }
      return marks;
    } catch {
      // A corrupt checkpoint falls back to a full resync rather than failing.
      // Re-pulling the catalogue is slow; refusing to sync at all is worse.
      return {};
    }
  }
}
