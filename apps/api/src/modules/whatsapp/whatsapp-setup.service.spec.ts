import { describe, expect, it } from "vitest";
import type { TenantDatabase } from "../../database/tenant-database.service.js";
import type { FetchLike } from "./meta-graph.js";
import { healthOf, WhatsappSetupService, type ConnectionCheck } from "./whatsapp-setup.service.js";

/**
 * The wizard's check, run against a fake Graph API. Each route answers by
 * path; anything unrouted is a 404 Graph error, as Meta would send.
 */
function fakeGraph(routes: Record<string, unknown>): FetchLike {
  return async (url) => {
    const path = new URL(url).pathname.replace(/^\/v\d+\.\d+\//, "");
    const body = routes[path];
    if (body === undefined) {
      return new Response(JSON.stringify({ error: { code: 100, error_subcode: 33, message: "does not exist" } }), {
        status: 400,
      });
    }
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

function service(routes: Record<string, unknown>) {
  const svc = new WhatsappSetupService({} as TenantDatabase);
  svc.fetchImpl = fakeGraph(routes);
  return svc;
}

const creds = { accessToken: "tok", appSecret: "sec", phoneNumberId: "555" };

const healthy = {
  debug_token: {
    data: {
      app_id: "42",
      is_valid: true,
      expires_at: 0,
      scopes: ["whatsapp_business_messaging", "whatsapp_business_management"],
      granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["777"] }],
    },
  },
  "555": { display_phone_number: "+971 50 123 4567", verified_name: "Al Lahiq", quality_rating: "GREEN", platform_type: "CLOUD_API" },
  "777/phone_numbers": { data: [{ id: "555" }] },
  "777/subscribed_apps": { data: [{ whatsapp_business_api_data: { id: "42" } }] },
};

describe("WhatsappSetupService.testConnection", () => {
  it("finds the number, its business account and the subscription from the token alone", async () => {
    const check = await service(healthy).testConnection(creds);
    expect(check).toMatchObject({
      ok: true,
      displayPhoneNumber: "+971 50 123 4567",
      verifiedName: "Al Lahiq",
      businessAccountId: "777",
      appId: "42",
      tokenNeverExpires: true,
      webhookSubscribed: true,
      needsBusinessAccountId: false,
    });
    expect(healthOf(check)).toBe("connected");
  });

  it("warns about a token that expires", async () => {
    const check = await service({
      ...healthy,
      debug_token: { data: { ...healthy.debug_token.data, expires_at: Math.floor(Date.now() / 1000) + 3600 } },
    }).testConnection(creds);
    expect(check.ok).toBe(true);
    expect(check.warnings.join(" ")).toMatch(/expires/);
    expect(healthOf(check)).toBe("token_expiring");
  });

  it("stops at the token step when Meta rejects the token", async () => {
    const svc = new WhatsappSetupService({} as TenantDatabase);
    svc.fetchImpl = async () =>
      new Response(JSON.stringify({ error: { code: 190, message: "Invalid OAuth access token" } }), { status: 400 });
    const check = await svc.testConnection(creds);
    expect(check).toMatchObject({ ok: false, problem: { step: "token", kind: "token_invalid" } });
    expect(healthOf(check)).toBe("token_invalid");
  });

  it("refuses a token that can't send messages", async () => {
    const check = await service({
      ...healthy,
      debug_token: { data: { ...healthy.debug_token.data, scopes: ["whatsapp_business_management"] } },
    }).testConnection(creds);
    expect(check).toMatchObject({ ok: false, problem: { step: "token", kind: "missing_permission" } });
  });

  it("reports a wrong phone number id at its own step", async () => {
    const check = await service(healthy).testConnection({ ...creds, phoneNumberId: "999" });
    expect(check).toMatchObject({ ok: false, problem: { step: "phone_number", kind: "not_found" } });
    expect(check.problem?.message).toContain("999");
  });

  it("asks for the business account when the token doesn't reveal it", async () => {
    const check = await service({
      ...healthy,
      debug_token: { data: { ...healthy.debug_token.data, granular_scopes: [] } },
    }).testConnection(creds);
    expect(check).toMatchObject({ ok: true, needsBusinessAccountId: true, businessAccountId: null, webhookSubscribed: null });
  });

  it("refuses a business account that doesn't own the number", async () => {
    const check = await service({ ...healthy, "888/phone_numbers": { data: [{ id: "111" }] } }).testConnection({
      ...creds,
      businessAccountId: "888",
    });
    expect(check).toMatchObject({ ok: false, problem: { step: "business_account" } });
  });

  it("notices an app that isn't subscribed to the account", async () => {
    const check = await service({ ...healthy, "777/subscribed_apps": { data: [] } }).testConnection(creds);
    expect(check.webhookSubscribed).toBe(false);
    expect(healthOf(check)).toBe("webhook_not_subscribed");
  });
});

describe("healthOf", () => {
  const base = { ok: true, tokenExpiresAt: null, webhookSubscribed: true } as unknown as ConnectionCheck;

  it("does not flag a token expiring months from now", () => {
    expect(healthOf({ ...base, tokenExpiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString() })).toBe("connected");
  });

  it("reads a failure that isn't the token as a general error", () => {
    expect(healthOf({ ...base, ok: false, problem: { kind: "network" } } as ConnectionCheck)).toBe("error");
  });
});
