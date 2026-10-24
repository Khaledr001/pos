import { describe, expect, it } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { RequestContext } from "../../common/context/request-context.js";
import type { TenantDatabase } from "../../database/tenant-database.service.js";
import { EmbeddedSignupService } from "./embedded-signup.service.js";

/**
 * The signup flow against a fake Meta and a fake database: what is called,
 * in what order, and — above all — that nothing is subscribed, registered or
 * saved for ids the signup token was never granted.
 */

const CONFIG: Record<string, string> = {
  META_APP_ID: "1234567890",
  META_APP_SECRET: "platform-secret",
  META_EMBEDDED_SIGNUP_CONFIG_ID: "998877",
  META_WEBHOOK_VERIFY_TOKEN: "verify-me",
};

type Call = { method: string; path: string; params: URLSearchParams };

function fakeMeta(overrides: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const routes: Record<string, unknown> = {
    "GET /oauth/access_token": { access_token: "BIZ-TOKEN" },
    "GET /debug_token": {
      data: {
        app_id: "1234567890",
        is_valid: true,
        expires_at: 0,
        scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
        granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["111"] }],
      },
    },
    "GET /111/phone_numbers": { data: [{ id: "555", display_phone_number: "+971 50 111 1111", verified_name: "Gulf Hardware" }] },
    "POST /111/subscribed_apps": { success: true },
    "POST /555/register": { success: true },
    "POST /555/smb_app_data": { success: true },
    ...overrides,
  };
  const fetchImpl = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const path = url.pathname.replace(/^\/v[\d.]+/, "");
    const method = init?.method ?? "GET";
    calls.push({ method, path, params: url.searchParams });
    const body = routes[`${method} ${path}`] ?? { error: { code: 100, message: `Unknown path ${path}` } };
    const status = (body as { error?: unknown }).error ? 400 : 200;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

function setup(options: { owner?: { tenantId: string } | null; meta?: Record<string, unknown> } = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const db = {
    runAsPlatformAdmin: async (fn: (tx: unknown) => unknown) =>
      fn({ query: { whatsappAccounts: { findFirst: async () => options.owner ?? undefined } } }),
    run: async (fn: (tx: unknown) => unknown) =>
      fn({
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            inserted.push(v);
            return { returning: async () => [{ id: "acc-1" }] };
          },
        }),
      }),
  } as unknown as TenantDatabase;
  const config = { get: (key: string) => CONFIG[key] } as unknown as ConfigService<never, true>;
  const service = new EmbeddedSignupService(db, config as never);
  const meta = fakeMeta(options.meta);
  service.fetchImpl = meta.fetchImpl;
  return { service, inserted, calls: meta.calls };
}

const asTenant = <T>(fn: () => T) => RequestContext.run({ requestId: "t", startedAt: 0, tenantId: "t1" } as never, fn);

const dto = (over: Partial<{ wabaId: string; coexistence: boolean }> = {}) => ({
  code: "one-time-code",
  wabaId: "111",
  phoneNumberId: "555",
  coexistence: false,
  ...over,
});

describe("EmbeddedSignupService", () => {
  it("connects a new number: exchange, verify, subscribe, register, save", async () => {
    const { service, inserted, calls } = setup();
    const result = await asTenant(() => service.complete(dto()));

    expect(result.ok).toBe(true);
    expect(result.displayPhoneNumber).toBe("+971 50 111 1111");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /oauth/access_token",
      "GET /debug_token",
      "GET /111/phone_numbers",
      "POST /111/subscribed_apps",
      "POST /555/register",
    ]);
    // The code exchange uses the app's credentials; the secret never came from the browser.
    expect(calls[0]!.params.get("client_secret")).toBe("platform-secret");
    expect(calls[4]!.params.get("pin")).toMatch(/^\d{6}$/);
    expect(inserted[0]).toMatchObject({
      tenantId: "t1",
      phoneNumberId: "555",
      businessAccountId: "111",
      accessToken: "BIZ-TOKEN",
      connectionMethod: "embedded",
      appSecret: null,
      verifyToken: null,
      coexistence: false,
      registrationPin: calls[4]!.params.get("pin"),
    });
  });

  it("connects a coexistence number without registering it, and requests the phone's history", async () => {
    const { service, inserted, calls } = setup();
    const result = await asTenant(() => service.complete(dto({ coexistence: true })));

    expect(result.ok).toBe(true);
    expect(result.historySyncRequested).toBe(true);
    // Registering would sign the owner's WhatsApp Business app out.
    expect(calls.some((c) => c.path.endsWith("/register"))).toBe(false);
    expect(calls.filter((c) => c.path === "/555/smb_app_data").map((c) => c.params.get("sync_type"))).toEqual([
      "smb_app_state_sync",
      "history",
    ]);
    expect(inserted[0]).toMatchObject({ coexistence: true, registrationPin: null });
    expect(inserted[0]!.historySyncRequestedAt).toBeInstanceOf(Date);
  });

  it("refuses a business account the token was never granted — and touches nothing", async () => {
    const { service, inserted, calls } = setup();
    const result = await asTenant(() => service.complete(dto({ wabaId: "999" })));

    expect(result.ok).toBe(false);
    expect(result.problem?.step).toBe("grant");
    expect(calls.map((c) => c.path)).toEqual(["/oauth/access_token", "/debug_token"]);
    expect(inserted).toEqual([]);
  });

  it("explains a used or expired sign-in code", async () => {
    const { service, inserted } = setup({
      meta: { "GET /oauth/access_token": { error: { code: 100, message: "This authorization code has been used.", fbtrace_id: "TRACE" } } },
    });
    const result = await asTenant(() => service.complete(dto()));

    expect(result.problem).toMatchObject({ step: "exchange", fbtraceId: "TRACE" });
    expect(result.problem?.message).toMatch(/start the connection again/i);
    expect(inserted).toEqual([]);
  });

  it("refuses a number another business already connected, before subscribing anything", async () => {
    const { service, inserted, calls } = setup({ owner: { tenantId: "someone-else" } });
    const result = await asTenant(() => service.complete(dto()));

    expect(result.problem?.step).toBe("duplicate");
    expect(result.problem?.message).toMatch(/another business/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(inserted).toEqual([]);
  });

  it("reports itself as off, with what's missing, when the platform app isn't configured", () => {
    const db = {} as TenantDatabase;
    const service = new EmbeddedSignupService(db, { get: () => undefined } as never);
    expect(service.getConfig()).toMatchObject({ enabled: false, missing: expect.arrayContaining(["META_APP_ID"]) });
  });
});
