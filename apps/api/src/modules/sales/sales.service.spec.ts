import type { AuthenticatedUser } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { describe, expect, it, vi } from "vitest";
import { RequestContext } from "../../common/context/request-context.js";
import type { TenantDatabase } from "../../database/tenant-database.service.js";
import type { OverrideGrantsService } from "../auth/override-grants.service.js";
import type { EinvoiceEnqueueService } from "../einvoice/einvoice-enqueue.service.js";
import type { StockService } from "../inventory/stock.service.js";
import type { PriceResolverService } from "../pricing/price-resolver.service.js";
import type { SerialsService } from "../serials/serials.service.js";
import { SalesService } from "./sales.service.js";

/** A thenable, chainable stand-in for a Drizzle query builder. */
function chain(result: unknown): any {
  const target: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result);
      return () => target;
    },
  });
  return target;
}

const USER: AuthenticatedUser = {
  id: "u1",
  tenantId: "t1",
  branchId: "b1",
  roleId: "r1",
  roleName: "manager",
  permissions: [],
  abac: { maxDiscountPercent: "10", maxSaleAmount: "1000", canApproveRefund: true, canViewCost: false, allowedBranchIds: [] },
  isPlatformAdmin: false,
  planId: "pro",
  trialEndsAt: null,
};

const SALE = {
  id: "s1",
  tenantId: "t1",
  branchId: "b1",
  customerId: null,
  status: "completed",
  returnOfSaleId: null,
  dueAmount: "0.0000",
  saleNumber: "INV-2026-000001",
};

function setup(opts: { sent: boolean; sale?: Record<string, unknown> }) {
  const writes: string[] = [];
  const order: string[] = [];
  const tx = {
    query: { sales: { findFirst: async () => ({ ...SALE, ...opts.sale }) } },
    select: () => chain([]),
    update: () => {
      writes.push("update");
      order.push("update");
      return chain([]);
    },
    insert: () => {
      writes.push("insert");
      return chain([]);
    },
  };
  const db = { run: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as TenantDatabase;
  const einvoice = {
    enqueueForSale: vi.fn(async () => {
      order.push("enqueue");
    }),
    hasBeenSent: vi.fn(async () => opts.sent),
    cancelForSale: vi.fn(async () => {
      order.push("cancel");
    }),
  };
  const service = new SalesService(
    db,
    {} as StockService,
    {} as PriceResolverService,
    {} as SerialsService,
    {} as OverrideGrantsService,
    einvoice as unknown as EinvoiceEnqueueService,
  );
  vi.spyOn(service, "findById").mockResolvedValue({ id: "s1" });
  const asUser = <T>(fn: () => T): T =>
    RequestContext.run({ requestId: "t", startedAt: 0, user: USER, tenantId: "t1" }, fn);
  return { service, einvoice, tx, writes, order, asUser };
}

describe("SalesService.void — e-invoicing", () => {
  it("refuses to void an invoice that has gone to the e-invoicing network, and changes nothing", async () => {
    const { service, einvoice, writes, asUser } = setup({ sent: true });
    const failure = await asUser(() => service.void("s1", { reason: "Entered in error" })).catch((e) => e);
    expect(failure).toBeInstanceOf(AppError);
    expect(failure.code).toBe(ERROR_CODES.EINVOICE_ALREADY_SENT);
    expect(failure.message).toContain("Issue a credit note instead");
    expect(einvoice.hasBeenSent).toHaveBeenCalledWith(expect.anything(), "s1");
    expect(einvoice.cancelForSale).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("voids an invoice nothing was sent for, and withdraws its queued e-invoice afterwards", async () => {
    const { service, einvoice, tx, order, asUser } = setup({ sent: false });
    await asUser(() => service.void("s1", { reason: "Entered in error" }));
    expect(einvoice.cancelForSale).toHaveBeenCalledWith(tx, "s1", "Entered in error");
    // The status write comes first: a document is only cancelled once it is really void.
    expect(order.indexOf("update")).toBeLessThan(order.indexOf("cancel"));
  });

  it("the sent check runs after the cheap refusals, so a voided sale still says it is voided", async () => {
    const { service, einvoice, asUser } = setup({ sent: true, sale: { status: "voided" } });
    const failure = await asUser(() => service.void("s1", { reason: "again" })).catch((e) => e);
    expect(failure.code).toBe(ERROR_CODES.SALE_ALREADY_VOIDED);
    expect(einvoice.hasBeenSent).not.toHaveBeenCalled();
  });

  it("a credit note can never be voided", async () => {
    const { service, asUser } = setup({ sent: false, sale: { returnOfSaleId: "orig" } });
    await expect(asUser(() => service.void("s1", { reason: "x" }))).rejects.toThrow(/credit|return document/i);
  });
});
