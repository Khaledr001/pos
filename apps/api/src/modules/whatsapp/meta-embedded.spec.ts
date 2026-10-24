import { describe, expect, it } from "vitest";
import {
  appAccessToken,
  checkWabaGrant,
  describeExchangeError,
  generatePin,
  readEmbeddedConfig,
  webhookSecretFor,
} from "./meta-embedded.js";
import type { TokenInfo } from "./meta-graph.js";

const env = (values: Record<string, string | undefined>) => (key: string) => values[key];
const full = {
  META_APP_ID: "1234567890",
  META_APP_SECRET: "app-secret",
  META_EMBEDDED_SIGNUP_CONFIG_ID: "998877",
  META_WEBHOOK_VERIFY_TOKEN: "verify-me",
};

describe("readEmbeddedConfig", () => {
  it("is off, naming what is missing, until all four are set", () => {
    const r = readEmbeddedConfig(env({ META_APP_ID: "1234567890", META_APP_SECRET: "  " }));
    expect(r).toEqual({ ok: false, missing: ["META_APP_SECRET", "META_EMBEDDED_SIGNUP_CONFIG_ID", "META_WEBHOOK_VERIFY_TOKEN"] });
  });

  it("rejects a non-numeric app id rather than handing it to Meta's SDK", () => {
    const r = readEmbeddedConfig(env({ ...full, META_APP_ID: "devsfleet" }));
    expect(r.ok).toBe(false);
  });

  it("reads a complete config", () => {
    const r = readEmbeddedConfig(env(full));
    expect(r.ok && r.config.configId).toBe("998877");
    expect(r.ok && appAccessToken(r.config)).toBe("1234567890|app-secret");
  });
});

describe("checkWabaGrant", () => {
  const token = (over: Partial<TokenInfo> = {}): TokenInfo => ({
    appId: "1234567890",
    isValid: true,
    expiresAt: null,
    scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
    wabaIds: ["111", "222"],
    ...over,
  });

  it("accepts a business account the token was granted", () => {
    expect(checkWabaGrant(token(), "1234567890", "222")).toEqual({ ok: true });
  });

  it("refuses an id the browser sent that Meta never granted — a tampered request", () => {
    expect(checkWabaGrant(token(), "1234567890", "999").ok).toBe(false);
  });

  it("refuses a token issued to another app", () => {
    expect(checkWabaGrant(token({ appId: "555" }), "1234567890", "111").ok).toBe(false);
  });

  it("refuses an invalid token", () => {
    expect(checkWabaGrant(token({ isValid: false }), "1234567890", "111").ok).toBe(false);
  });
});

describe("webhookSecretFor", () => {
  it("uses a manual number's own app secret", () => {
    expect(webhookSecretFor({ connectionMethod: "manual", appSecret: "own" }, "platform")).toBe("own");
  });

  it("uses the platform secret for an embedded number, never a stored one", () => {
    expect(webhookSecretFor({ connectionMethod: "embedded", appSecret: null }, "platform")).toBe("platform");
  });

  it("has nothing to verify with when the platform secret is unset", () => {
    expect(webhookSecretFor({ connectionMethod: "embedded", appSecret: null }, undefined)).toBeNull();
    expect(webhookSecretFor({ connectionMethod: "embedded", appSecret: null }, "  ")).toBeNull();
  });

  it("has nothing for a manual row missing its secret", () => {
    expect(webhookSecretFor({ connectionMethod: "manual", appSecret: null }, "platform")).toBeNull();
  });
});

describe("describeExchangeError", () => {
  it("turns a used or expired code into 'start again'", () => {
    const p = describeExchangeError({ kind: "not_found", message: "x", detail: "This authorization code has been used." });
    expect(p.message).toMatch(/start the connection again/i);
  });

  it("blames the server, not the shop, for a wrong client secret", () => {
    const p = describeExchangeError({ kind: "unknown", message: "x", detail: "Error validating client secret." });
    expect(p.message).toMatch(/contact support/i);
  });

  it("blames the server for an app id Meta doesn't know — Meta's real answer was 'Invalid Client ID'", () => {
    const p = describeExchangeError({ kind: "unknown", message: "x", detail: "Invalid Client ID" });
    expect(p.message).toMatch(/isn't set up correctly/);
  });

  it("keeps network problems as they are", () => {
    expect(describeExchangeError({ kind: "network", message: "offline" }).message).toBe("offline");
  });
});

describe("generatePin", () => {
  it("is six digits", () => {
    for (let i = 0; i < 50; i++) expect(generatePin()).toMatch(/^\d{6}$/);
  });
});
