import { describe, expect, it, vi } from "vitest";
import { RequestContext } from "../../../common/context/request-context.js";
import type { TenantDatabase } from "../../../database/tenant-database.service.js";
import type { SalesService } from "../../sales/sales.service.js";
import type { NotificationEnqueueService } from "../notifications/notification-enqueue.service.js";
import { WebOrdersService } from "./web-orders.service.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";

function setup() {
  const order: string[] = [];
  const tx = { insert: () => ({ values: async () => void order.push("event") }) } as never;
  const enqueueOrder = vi.fn(async (_tx: unknown, _id: string, status: string) => void order.push(`enqueue:${status}`));
  const svc = new WebOrdersService({} as TenantDatabase, {} as SalesService, { enqueueOrder } as unknown as NotificationEnqueueService);
  const record = (...args: Parameters<WebOrdersService["recordEvent"]> extends [unknown, ...infer R] ? R : never) =>
    RequestContext.run({ requestId: "t", startedAt: 0, tenantId: TENANT }, () => svc.recordEvent(tx, ...args));
  return { record, enqueueOrder, order };
}

describe("WebOrdersService.recordEvent", () => {
  it("queues the shopper's message in the same transaction, right after the timeline entry", async () => {
    const { record, enqueueOrder, order } = setup();
    await record(ORDER, "shipped", "Handed to courier", "user-1");
    expect(enqueueOrder).toHaveBeenCalledWith(expect.anything(), ORDER, "shipped");
    expect(order).toEqual(["event", "enqueue:shipped"]);
  });

  it("writes the timeline entry but queues nothing when the caller says the shopper need not hear it", async () => {
    const { record, enqueueOrder, order } = setup();
    await record(ORDER, "cancelled", "Payment was not completed in time.", null, { notify: false });
    expect(enqueueOrder).not.toHaveBeenCalled();
    expect(order).toEqual(["event"]);
  });
});
