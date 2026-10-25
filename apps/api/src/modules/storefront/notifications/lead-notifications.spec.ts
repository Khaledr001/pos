import { resolveStorefrontSettings, resolveTenantSettings } from "@devsfleet/shared-types";
import { describe, expect, it } from "vitest";
import { RequestContext, type StorefrontScope } from "../../../common/context/request-context.js";
import type { StorefrontResolver } from "../context/storefront-resolver.service.js";
import { renderEmail } from "./email-templates.js";
import { NotificationEnqueueService } from "./notification-enqueue.service.js";
import type { LeadSnapshot, NotificationPayload } from "./notification-types.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const LEAD = "55555555-5555-4555-8555-555555555555";

const scope = (businessEmail: string | null = "hi@example.com", notifications: Record<string, unknown> = {}): StorefrontScope =>
  ({
    id: "sf",
    tenantId: TENANT,
    name: "Acme Co",
    siteUrl: "https://shop.example.com/",
    tenantName: "Acme LLC",
    settings: resolveStorefrontSettings({ notifications } as never),
    tenantSettings: resolveTenantSettings({ phone: "+97140000000", ...(businessEmail ? { email: businessEmail } : {}) }),
  }) as StorefrontScope;

const lead = (over: Record<string, unknown> = {}) => ({
  id: LEAD,
  formId: "form-1",
  formName: "Contact us",
  name: "Sara",
  email: "sara@example.com",
  phone: "+971501234567",
  answers: [
    { label: "Name", value: "Sara" },
    { label: "Message", value: "Hello <b>there</b>" },
  ],
  productName: null,
  productSku: null,
  sourcePath: "/pages/contact",
  ...over,
});

const form = (over: Record<string, unknown> = {}) => ({ id: "form-1", notifyEmails: ["sales@shop.test", "boss@shop.test"], acknowledge: true, ...over });

function fakeTx(opts: { lead?: unknown; form?: unknown } = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const tx = {
    query: {
      storefrontLeads: { findFirst: async () => ("lead" in opts ? opts.lead : lead()) },
      storefrontForms: { findFirst: async () => ("form" in opts ? opts.form : form()) },
    },
    insert: () => ({
      values: (rows: Array<Record<string, unknown>>) => {
        inserted.push(...rows);
        return { onConflictDoNothing: async () => undefined };
      },
    }),
  };
  return { tx: tx as never, inserted };
}

const service = new NotificationEnqueueService({} as StorefrontResolver);
const run = <T>(s: StorefrontScope, fn: () => Promise<T>) => RequestContext.run({ requestId: "t", startedAt: 0, tenantId: TENANT, storefront: s }, fn);
const payloadOf = (row: Record<string, unknown>) => row.payload as NotificationPayload;

describe("enqueueLead", () => {
  it("emails every staff address on the form, and acknowledges the visitor", async () => {
    const { tx, inserted } = fakeTx();
    await run(scope(), () => service.enqueueLead(tx, LEAD, { notifyStaff: true }));
    expect(inserted.map((r) => [r.event, r.recipient])).toEqual([
      ["lead_received", "sales@shop.test"],
      ["lead_received", "boss@shop.test"],
      ["lead_acknowledged", "sara@example.com"],
    ]);
    for (const row of inserted) {
      expect(row).toMatchObject({ channel: "email", status: "queued", subjectKind: "lead", subjectId: LEAD, tenantId: TENANT });
    }
  });

  it("lets staff reply straight to the visitor, and points the visitor's reply at the shop", async () => {
    const { tx, inserted } = fakeTx();
    await run(scope(), () => service.enqueueLead(tx, LEAD, { notifyStaff: true }));
    expect(payloadOf(inserted[0]!).replyTo).toBe("sara@example.com");
    expect(payloadOf(inserted[2]!).replyTo).toBe("hi@example.com");
  });

  it("falls back to the business email when the form names no staff address", async () => {
    const { tx, inserted } = fakeTx({ form: form({ notifyEmails: [] }) });
    await run(scope("owner@acme.test"), () => service.enqueueLead(tx, LEAD, { notifyStaff: true }));
    expect(inserted.find((r) => r.event === "lead_received")?.recipient).toBe("owner@acme.test");
  });

  it("records a visible skipped row when nobody could be told", async () => {
    const { tx, inserted } = fakeTx({ form: form({ notifyEmails: [] }) });
    await run(scope(null), () => service.enqueueLead(tx, LEAD, { notifyStaff: true }));
    const skipped = inserted.find((r) => r.event === "lead_received");
    expect(skipped).toMatchObject({ status: "skipped", recipient: "" });
    expect(String(skipped!.lastError)).toMatch(/No staff email/);
  });

  it("sends no acknowledgement when the form does not ask for one, or the visitor gave no email", async () => {
    const a = fakeTx({ form: form({ acknowledge: false }) });
    await run(scope(), () => service.enqueueLead(a.tx, LEAD, { notifyStaff: true }));
    expect(a.inserted.map((r) => r.event)).toEqual(["lead_received", "lead_received"]);

    const b = fakeTx({ lead: lead({ email: null }) });
    await run(scope(), () => service.enqueueLead(b.tx, LEAD, { notifyStaff: true }));
    expect(b.inserted.map((r) => r.event)).toEqual(["lead_received", "lead_received"]);
  });

  it("holds back staff mail during a flood but still acknowledges the visitor", async () => {
    const { tx, inserted } = fakeTx();
    await run(scope(), () => service.enqueueLead(tx, LEAD, { notifyStaff: false }));
    expect(inserted.map((r) => r.event)).toEqual(["lead_acknowledged"]);
  });

  it("does not trust an address that is not a plain mailbox", async () => {
    const { tx, inserted } = fakeTx({ lead: lead({ email: "x@y.co\r\nBcc: z@y.co" }), form: form({ notifyEmails: ["Name <a@b.co>", "ok@shop.test"] }) });
    await run(scope(), () => service.enqueueLead(tx, LEAD, { notifyStaff: true }));
    expect(inserted.map((r) => r.recipient)).toEqual(["ok@shop.test"]);
    expect(payloadOf(inserted[0]!).replyTo).toBe("hi@example.com");
  });

  it("gives every row a dedupe key that fits its column and differs per recipient", async () => {
    const long = `${"a".repeat(60)}@${"b".repeat(60)}.example.com`;
    const { tx, inserted } = fakeTx({ form: form({ notifyEmails: [long, "boss@shop.test"] }) });
    await run(scope(), () => service.enqueueLead(tx, LEAD, { notifyStaff: true }));
    const keys = inserted.map((r) => String(r.dedupeKey));
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key.length).toBeLessThanOrEqual(160);
  });

  it("snapshots the answers into the payload, so editing the form later changes nothing", async () => {
    const { tx, inserted } = fakeTx();
    await run(scope(), () => service.enqueueLead(tx, LEAD, { notifyStaff: true }));
    expect(payloadOf(inserted[0]!).lead).toMatchObject({ formName: "Contact us", answers: [{ label: "Name", value: "Sara" }, { label: "Message", value: "Hello <b>there</b>" }] });
  });

  it("is quiet for a lead that no longer exists, or outside a storefront", async () => {
    const gone = fakeTx({ lead: undefined });
    await run(scope(), () => service.enqueueLead(gone.tx, LEAD, { notifyStaff: true }));
    expect(gone.inserted).toHaveLength(0);
    const { tx, inserted } = fakeTx();
    await RequestContext.run({ requestId: "t", startedAt: 0 }, () => service.enqueueLead(tx, LEAD, { notifyStaff: true }));
    expect(inserted).toHaveLength(0);
  });
});

const snapshot = (over: Partial<LeadSnapshot> = {}): LeadSnapshot => ({
  formName: "Contact us",
  name: "Sara",
  email: "sara@example.com",
  phone: "+971501234567",
  answers: [
    { label: "Name", value: "Sara" },
    { label: "Message", value: "Hello <script>alert(1)</script>\nSecond line" },
  ],
  productName: "Mixer tap",
  productSku: "TAP-1",
  sourcePath: "/product/mixer-tap",
  ...over,
});

const leadPayload = (event: "lead_received" | "lead_acknowledged", over: Partial<NotificationPayload> = {}): NotificationPayload => ({
  event,
  shop: { name: "Acme Co", logoUrl: null, accent: "#0e6b53", origin: "https://shop.example.com", phone: "+971 4 000 0000", email: "hi@example.com" },
  customerName: "Sara",
  fromName: "Acme Co",
  replyTo: "sara@example.com",
  lead: snapshot(),
  ...over,
});

describe("lead emails", () => {
  it("tells staff who wrote, about which product and from which page, with the answers", () => {
    const out = renderEmail(leadPayload("lead_received"));
    expect(out.subject).toBe("New Contact us: Mixer tap");
    expect(out.html).toContain("Mixer tap");
    expect(out.html).toContain("TAP-1");
    expect(out.html).toContain("/product/mixer-tap");
    expect(out.html).toContain("Message");
    expect(out.text).toContain("Message: Hello");
    expect(out.html).not.toContain("undefined");
  });

  it("escapes everything the visitor typed", () => {
    const out = renderEmail(leadPayload("lead_received", { lead: snapshot({ name: "<img src=x onerror=alert(1)>", productName: null }) }));
    expect(out.html).not.toContain("<script>");
    expect(out.html).not.toContain("<img src=x");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("keeps a subject on one line even if the form's name has a line break", () => {
    const out = renderEmail(leadPayload("lead_received", { lead: snapshot({ formName: "Contact\r\nBcc: evil@x.test", productName: null }) }));
    expect(out.subject).not.toMatch(/[\r\n]/);
  });

  it("thanks the visitor and sends them a copy of what they sent", () => {
    const out = renderEmail(leadPayload("lead_acknowledged"));
    expect(out.subject).toBe("We've received your message");
    expect(out.html).toContain("Hi Sara");
    expect(out.html).toContain("Message");
    expect(out.html).toContain("&lt;script&gt;");
  });

  it("falls back gracefully for an anonymous lead", () => {
    const out = renderEmail(leadPayload("lead_received", { customerName: "", lead: snapshot({ name: null, email: null, phone: null, productName: null, sourcePath: null }) }));
    expect(out.text).toContain("A visitor submitted");
  });
});
