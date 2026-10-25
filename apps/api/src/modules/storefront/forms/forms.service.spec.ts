import { DEFAULT_STOREFRONT_SETTINGS, DEFAULT_TENANT_SETTINGS, type FormField } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { RequestContext } from "../../../common/context/request-context.js";
import type { TenantDatabase } from "../../../database/tenant-database.service.js";
import type { NotificationEnqueueService } from "../notifications/notification-enqueue.service.js";
import { FormsService } from "./forms.service.js";
import type { SubmitFormDto } from "./dto.js";

const fields: FormField[] = [
  { key: "name", type: "text", label: "Name", required: true, role: "name" },
  { key: "email", type: "email", label: "Email", required: true, role: "email" },
  { key: "message", type: "textarea", label: "Message", required: false },
];
const form = { id: "form-1", slug: "contact", name: "Contact us", fields, submitLabel: "Send", successMessage: "Thanks!", notifyEmails: ["staff@shop.test"], acknowledge: true, isActive: true };

interface Options {
  form?: typeof form | undefined;
  duplicate?: boolean;
  recent?: number;
  product?: { id: string; name: string; sku: string } | undefined;
}

/** The service over a fake transaction that records inserts and notification calls. */
function setup(options: Options = {}) {
  const inserted: Record<string, unknown>[] = [];
  const enqueued: { leadId: string; notifyStaff: boolean }[] = [];
  const hasForm = "form" in options ? options.form : form;
  const tx = {
    query: {
      storefrontForms: { findFirst: async () => hasForm },
      products: { findFirst: async () => options.product },
    },
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (options.duplicate ? [{ id: "lead-0" }] : []) }) }) }),
    execute: async () => [{ n: options.recent ?? 0 }],
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return { returning: async () => [{ id: "lead-1" }] };
      },
    }),
  };
  const db = { run: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as TenantDatabase;
  const enqueue = { enqueueLead: async (_tx: unknown, leadId: string, o: { notifyStaff: boolean }) => void enqueued.push({ leadId, ...o }) } as unknown as NotificationEnqueueService;
  const config = { get: (key: string) => (key === "JWT_ACCESS_SECRET" ? "a".repeat(40) : undefined) } as never;
  const service = new FormsService(db, enqueue, config);
  const scope = {
    id: "sf-1",
    tenantId: "tenant-1",
    name: "Shop",
    siteUrl: "https://shop.test",
    settings: DEFAULT_STOREFRONT_SETTINGS,
    tenantName: "T",
    tenantSettings: DEFAULT_TENANT_SETTINGS,
  };
  const submit = (dto: Partial<SubmitFormDto> = {}, ip: string | null = "203.0.113.9") =>
    RequestContext.run({ requestId: "t", startedAt: 0, tenantId: "tenant-1", storefront: scope } as never, () =>
      service.submit("contact", { values: { name: "Sara", email: "sara@example.com", message: "Hello" }, ...dto }, ip),
    );
  const get = () => RequestContext.run({ requestId: "t", startedAt: 0, tenantId: "tenant-1" } as never, () => service.get("contact"));
  return { submit, get, inserted, enqueued };
}

describe("FormsService.get", () => {
  it("returns only what a browser may see — never the staff addresses", async () => {
    const { get } = setup();
    const result = await get();
    expect(result).toEqual({ slug: "contact", name: "Contact us", fields, submitLabel: "Send", successMessage: "Thanks!" });
    expect(JSON.stringify(result)).not.toContain("staff@shop.test");
  });

  it("is a 404 for a form that is missing or switched off", async () => {
    await expect(setup({ form: undefined }).get()).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });
});

describe("FormsService.submit", () => {
  it("stores the lead with its answers snapshotted, then queues the notifications in the same transaction", async () => {
    const { submit, inserted, enqueued } = setup();
    expect(await submit()).toEqual({ ok: true, message: "Thanks!" });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      tenantId: "tenant-1",
      formId: "form-1",
      formSlug: "contact",
      formName: "Contact us",
      name: "Sara",
      email: "sara@example.com",
      answers: [
        { label: "Name", value: "Sara" },
        { label: "Email", value: "sara@example.com" },
        { label: "Message", value: "Hello" },
      ],
    });
    expect(enqueued).toEqual([{ leadId: "lead-1", notifyStaff: true }]);
  });

  it("keeps a hash of the visitor's address, never the address", async () => {
    const { submit, inserted } = setup();
    await submit({}, "203.0.113.9");
    const hash = inserted[0]!.ipHash as string;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(inserted[0])).not.toContain("203.0.113.9");
    const other = setup();
    await other.submit({}, "203.0.113.10");
    expect(other.inserted[0]!.ipHash).not.toBe(hash);
  });

  it("answers a honeypot hit exactly like a real submission, and stores nothing", async () => {
    const { submit, inserted, enqueued } = setup();
    expect(await submit({ website: "http://spam.test" })).toEqual({ ok: true, message: "Thanks!" });
    expect(inserted).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it("drops a submission sent within two seconds of the form being shown, but not a clock running ahead", async () => {
    const fast = setup();
    expect(await fast.submit({ startedAt: Date.now() - 500 })).toEqual({ ok: true, message: "Thanks!" });
    expect(fast.inserted).toHaveLength(0);

    const slow = setup();
    await slow.submit({ startedAt: Date.now() - 10_000 });
    expect(slow.inserted).toHaveLength(1);

    const skewed = setup();
    await skewed.submit({ startedAt: Date.now() + 60_000 });
    expect(skewed.inserted).toHaveLength(1);
  });

  it("treats an identical submission within five minutes as the same one", async () => {
    const { submit, inserted, enqueued } = setup({ duplicate: true });
    expect(await submit()).toEqual({ ok: true, message: "Thanks!" });
    expect(inserted).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it("rejects a wrong submission with field-level errors", async () => {
    const { submit, inserted } = setup();
    const error = await submit({ values: { name: "", email: "nope" } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ZodError);
    const paths = (error as ZodError).issues.map((i) => i.path.join("."));
    expect(paths.sort()).toEqual(["email", "name"]);
    expect(inserted).toHaveLength(0);
  });

  it("is a 404 for a form that does not exist, even for a honeypot hit", async () => {
    const { submit } = setup({ form: undefined });
    await expect(submit({ website: "x" })).rejects.toBeInstanceOf(AppError);
  });

  it("looks the product up itself — a name and SKU the visitor typed are never trusted", async () => {
    const { submit, inserted } = setup({ product: { id: "prod-1", name: "Mixer tap", sku: "TAP-1" } });
    await submit({ source: { productId: "7b5a1e7e-8c3a-4a39-9b66-0b8a5bd9c0aa", path: "/product/mixer-tap" }, values: { name: "Sara", email: "sara@example.com", productName: "FAKE", productSku: "FAKE" } });
    expect(inserted[0]).toMatchObject({ productId: "prod-1", productName: "Mixer tap", productSku: "TAP-1", sourcePath: "/product/mixer-tap" });
    expect(JSON.stringify(inserted[0])).not.toContain("FAKE");
  });

  it("ignores a product id that does not exist", async () => {
    const { submit, inserted } = setup({ product: undefined });
    await submit({ source: { productId: "7b5a1e7e-8c3a-4a39-9b66-0b8a5bd9c0aa" } });
    expect(inserted[0]).toMatchObject({ productId: null, productName: null, productSku: null });
  });

  it("keeps storing leads in a flood but stops mailing staff about each one", async () => {
    const { submit, inserted, enqueued } = setup({ recent: 30 });
    await submit();
    expect(inserted).toHaveLength(1);
    expect(enqueued).toEqual([{ leadId: "lead-1", notifyStaff: false }]);
  });
});
