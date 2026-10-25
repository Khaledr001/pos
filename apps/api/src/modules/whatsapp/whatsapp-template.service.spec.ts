import { WHATSAPP_TEMPLATE_DEFS } from "@devsfleet/shared-types";
import { describe, expect, it, vi } from "vitest";
import type { TenantDatabase } from "../../database/tenant-database.service.js";
import type { WhatsappService } from "./whatsapp.service.js";
import {
  cleanVariable,
  templateCreateBody,
  templateMessageBody,
  toApprovalState,
  WhatsappTemplateService,
} from "./whatsapp-template.service.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const account = {
  id: "acc",
  tenantId: TENANT,
  phoneNumberId: "PNID",
  businessAccountId: "WABA",
  accessToken: "tok",
  appSecret: "secret",
  connectionMethod: "manual",
  isActive: true,
};

function service(opts: { account?: unknown; responses: Array<{ status: number; body: unknown }> }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const db = {
    runAs: (_t: string, fn: (tx: unknown) => unknown) => fn({ query: { whatsappAccounts: { findFirst: async () => ("account" in opts ? opts.account : account) } } }),
  } as unknown as TenantDatabase;
  const recordTemplateSend = vi.fn(async () => undefined);
  const svc = new WhatsappTemplateService(db, { recordTemplateSend } as unknown as WhatsappService);
  svc.fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = opts.responses[Math.min(i++, opts.responses.length - 1)]!;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  };
  return { svc, calls, recordTemplateSend };
}

describe("message bodies", () => {
  it("builds a template message with body parameters and no leading +", () => {
    expect(templateMessageBody("+971501234567", "df_order_placed", "en", ["Sara", "W-1"])).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "971501234567",
      type: "template",
      template: {
        name: "df_order_placed",
        language: { code: "en" },
        components: [{ type: "body", parameters: [{ type: "text", text: "Sara" }, { type: "text", text: "W-1" }] }],
      },
    });
  });

  it("cleans variables to what Meta accepts", () => {
    expect(cleanVariable("a\nb\t c    d")).toBe("a b c d");
    expect(cleanVariable("   ")).toBe("-");
    expect(cleanVariable("x".repeat(5000)).length).toBe(1000);
  });

  it("builds a creation body with one example per variable", () => {
    const def = WHATSAPP_TEMPLATE_DEFS.order_placed;
    const body = templateCreateBody(def);
    expect(body).toMatchObject({ name: "df_order_placed", language: "en", category: "UTILITY" });
    expect(body.components[0]).toMatchObject({ type: "BODY", text: def.body, example: { body_text: [def.examples] } });
  });

  it("maps Meta's statuses", () => {
    expect(toApprovalState("APPROVED")).toBe("approved");
    expect(toApprovalState("rejected")).toBe("rejected");
    expect(toApprovalState("PAUSED")).toBe("paused");
    expect(toApprovalState("DISABLED")).toBe("paused");
    expect(toApprovalState("PENDING")).toBe("pending");
    expect(toApprovalState("IN_APPEAL")).toBe("pending");
    expect(toApprovalState(undefined)).toBe("pending");
  });
});

describe("sendTemplate", () => {
  const input = { to: "+971501234567", templateName: "df_order_placed", language: "en", variables: ["Sara"] };

  it("posts the template to the account's number and files it in the inbox", async () => {
    const { svc, calls, recordTemplateSend } = service({ responses: [{ status: 200, body: { messages: [{ id: "wamid.1" }] } }] });
    expect(await svc.sendTemplate(TENANT, input)).toEqual({ ok: true, waMessageId: "wamid.1" });
    expect(calls[0]!.url).toContain("/PNID/messages");
    expect(JSON.parse(String(calls[0]!.init.body)).type).toBe("template");
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe("Bearer tok");
    expect(recordTemplateSend).toHaveBeenCalledWith(account, expect.objectContaining({ to: "971501234567", waMessageId: "wamid.1" }));
  });

  it("fails permanently when no number is connected", async () => {
    const { svc } = service({ account: undefined, responses: [] });
    expect(await svc.sendTemplate(TENANT, input)).toMatchObject({ ok: false, permanent: true });
  });

  it("treats a missing template as permanent", async () => {
    const { svc } = service({ responses: [{ status: 400, body: { error: { code: 132001, message: "(#132001) Template name does not exist in the translation" } } }] });
    expect(await svc.sendTemplate(TENANT, input)).toMatchObject({ ok: false, permanent: true });
  });

  it("treats a rate limit and an outage as retryable", async () => {
    for (const code of [80007, 1]) {
      const { svc } = service({ responses: [{ status: 429, body: { error: { code, message: "slow down" } } }] });
      expect(await svc.sendTemplate(TENANT, input)).toMatchObject({ ok: false, permanent: false });
    }
  });

  it("treats an expired token as permanent, and a missing message id as retryable", async () => {
    const expired = service({ responses: [{ status: 401, body: { error: { code: 190, error_subcode: 463, message: "expired" } } }] });
    expect(await expired.svc.sendTemplate(TENANT, input)).toMatchObject({ ok: false, permanent: true });
    const noId = service({ responses: [{ status: 200, body: {} }] });
    expect(await noId.svc.sendTemplate(TENANT, input)).toMatchObject({ ok: false, permanent: false });
  });

  it("does not file anything in the inbox when the send fails", async () => {
    const { svc, recordTemplateSend } = service({ responses: [{ status: 400, body: { error: { code: 132001, message: "template" } } }] });
    await svc.sendTemplate(TENANT, input);
    expect(recordTemplateSend).not.toHaveBeenCalled();
  });
});

describe("template management", () => {
  const remote = { data: [{ name: "df_order_placed", language: "en", status: "APPROVED" }, { name: "df_order_shipped", language: "en", status: "REJECTED", rejected_reason: "INVALID_FORMAT" }] };

  it("lists the account's templates with their approval state and reason", async () => {
    const { svc, calls } = service({ responses: [{ status: 200, body: remote }] });
    expect(await svc.listTemplates(TENANT)).toEqual({
      connected: true,
      templates: [
        { name: "df_order_placed", language: "en", state: "approved", reason: null },
        { name: "df_order_shipped", language: "en", state: "rejected", reason: "INVALID_FORMAT" },
      ],
    });
    expect(calls[0]!.url).toContain("/WABA/message_templates");
  });

  it("reports not connected without calling Meta", async () => {
    const { svc, calls } = service({ account: undefined, responses: [] });
    expect(await svc.listTemplates(TENANT)).toEqual({ connected: false, templates: [] });
    expect(calls).toHaveLength(0);
  });

  it("surfaces Meta's problem as a readable error", async () => {
    const { svc } = service({ responses: [{ status: 401, body: { error: { code: 190, message: "bad token" } } }] });
    await expect(svc.listTemplates(TENANT)).rejects.toThrow(/access token/i);
  });

  it("asks for the business account id when it was never saved", async () => {
    const { svc } = service({ account: { ...account, businessAccountId: null }, responses: [] });
    await expect(svc.listTemplates(TENANT)).rejects.toThrow(/business account id/i);
  });

  it("creates only the templates Meta does not have, and reports refusals", async () => {
    const { svc, calls } = service({
      responses: [
        { status: 200, body: { id: "1" } },
        { status: 400, body: { error: { code: 100, message: "Invalid parameter" } } },
      ],
    });
    const defs = (["order_placed", "order_shipped", "order_cancelled"] as const).map((event) => ({ event, def: WHATSAPP_TEMPLATE_DEFS[event] }));
    const existing = [{ name: "df_order_placed", language: "en", state: "approved" as const, reason: null }];
    const refused = await svc.createMissing(TENANT, defs, existing);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => JSON.parse(String(c.init.body)).name)).toEqual(["df_order_shipped", "df_order_cancelled"]);
    expect(refused).toEqual([{ event: "order_cancelled", message: expect.stringContaining("Invalid parameter") }]);
  });
});
