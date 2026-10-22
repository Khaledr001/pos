import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  appSecretProof,
  describeGraphError,
  generateVerifyToken,
  graphCall,
  isValidCallbackUrl,
  missingScopes,
  networkProblem,
  parseDebugToken,
} from "./meta-graph.js";

describe("describeGraphError", () => {
  it("reads an expired token as expired, and says how to get a permanent one", () => {
    const p = describeGraphError({ code: 190, error_subcode: 463, message: "Session has expired", fbtrace_id: "Abc" });
    expect(p.kind).toBe("token_expired");
    expect(p.message).toMatch(/System users/);
    expect(p.fbtraceId).toBe("Abc");
  });

  it("reads any other 190 as an invalid token", () => {
    expect(describeGraphError({ code: 190, message: "Invalid OAuth access token - Cannot parse access token" }).kind).toBe(
      "token_invalid",
    );
  });

  it("names a wrong app secret before anything else", () => {
    const p = describeGraphError({ code: 100, message: "Invalid appsecret_proof provided in the API argument" });
    expect(p.kind).toBe("wrong_app_secret");
    expect(p.message).toMatch(/App secret/);
  });

  it("says which value wasn't found", () => {
    const p = describeGraphError(
      { code: 100, error_subcode: 33, message: "Unsupported get request. Object with ID '123' does not exist" },
      "the phone number ID 123",
    );
    expect(p.kind).toBe("not_found");
    expect(p.message).toContain("the phone number ID 123");
  });

  it.each([10, 200, 294])("reads code %i as a missing permission", (code) => {
    expect(describeGraphError({ code, message: "Permission denied" }).kind).toBe("missing_permission");
  });

  it("recognises Meta failing to reach the callback", () => {
    expect(describeGraphError({ code: 2200, message: "Callback verification failed" }).kind).toBe("callback_unreachable");
  });

  it("recognises rate limits and Meta outages", () => {
    expect(describeGraphError({ code: 4 }).kind).toBe("rate_limited");
    expect(describeGraphError({ code: 2 }).kind).toBe("meta_unavailable");
  });

  it("falls back to Meta's own words, never an empty message", () => {
    expect(describeGraphError({ code: 999, message: "Something odd" }).message).toContain("Something odd");
    expect(describeGraphError(undefined).message.length).toBeGreaterThan(10);
  });
});

describe("networkProblem", () => {
  it("tells a timeout from other failures", () => {
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    expect(networkProblem(timeout).message).toMatch(/10 seconds/);
    expect(networkProblem(new Error("ENOTFOUND")).message).toMatch(/couldn't reach Meta/);
  });
});

describe("appSecretProof", () => {
  it("is HMAC-SHA256 of the token keyed by the secret, in hex", () => {
    expect(appSecretProof("tok", "sec")).toBe(createHmac("sha256", "sec").update("tok").digest("hex"));
  });
});

describe("generateVerifyToken", () => {
  it("is long, url-safe and different every time", () => {
    const a = generateVerifyToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(generateVerifyToken()).not.toBe(a);
  });
});

describe("isValidCallbackUrl", () => {
  it("accepts public https on the webhook path", () => {
    expect(isValidCallbackUrl("https://api.example.com/api/v1/whatsapp/webhook")).toBe(true);
    expect(isValidCallbackUrl("https://api.example.com/api/v1/whatsapp/webhook/")).toBe(true);
  });

  it("refuses http, other paths and query strings", () => {
    expect(isValidCallbackUrl("http://api.example.com/api/v1/whatsapp/webhook")).toBe(false);
    expect(isValidCallbackUrl("https://evil.example.com/collect")).toBe(false);
    expect(isValidCallbackUrl("https://api.example.com/api/v1/whatsapp/webhook?x=1")).toBe(false);
    expect(isValidCallbackUrl("not a url")).toBe(false);
  });
});

describe("parseDebugToken", () => {
  it("reads expiry, scopes and the business accounts the token covers", () => {
    const info = parseDebugToken({
      data: {
        app_id: "42",
        is_valid: true,
        expires_at: 1_800_000_000,
        scopes: ["whatsapp_business_messaging"],
        granular_scopes: [
          { scope: "whatsapp_business_management", target_ids: ["111"] },
          { scope: "whatsapp_business_messaging", target_ids: ["111", "222"] },
          { scope: "business_management", target_ids: ["999"] },
        ],
      },
    });
    expect(info).toMatchObject({ appId: "42", isValid: true, wabaIds: ["111", "222"] });
    expect(info.expiresAt?.toISOString()).toBe(new Date(1_800_000_000_000).toISOString());
  });

  it("treats expires_at 0 as never", () => {
    expect(parseDebugToken({ data: { is_valid: true, expires_at: 0 } }).expiresAt).toBeNull();
  });

  it("lists the permissions a token is missing", () => {
    expect(missingScopes(["whatsapp_business_messaging"])).toEqual(["whatsapp_business_management"]);
  });
});

describe("graphCall", () => {
  it("sends the token as a header and the proof as a parameter, never the token in the URL", async () => {
    let seenUrl = "";
    let seenAuth = "";
    const result = await graphCall<{ id: string }>("123", {
      accessToken: "secret-token",
      appSecret: "app-secret",
      fetchImpl: async (url, init) => {
        seenUrl = url;
        seenAuth = (init?.headers as Record<string, string>).authorization;
        return new Response(JSON.stringify({ id: "123" }), { status: 200 });
      },
    });
    expect(result).toEqual({ ok: true, data: { id: "123" } });
    expect(seenAuth).toBe("Bearer secret-token");
    expect(seenUrl).not.toContain("secret-token");
    expect(new URL(seenUrl).searchParams.get("appsecret_proof")).toBe(appSecretProof("secret-token", "app-secret"));
  });

  it("maps a Graph error body to a problem", async () => {
    const result = await graphCall("123", {
      accessToken: "t",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { code: 190, message: "Invalid OAuth access token", fbtrace_id: "X" } }), {
          status: 400,
        }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatchObject({ kind: "token_invalid", fbtraceId: "X" });
  });

  it("turns a thrown fetch into a network problem", async () => {
    const result = await graphCall("123", {
      accessToken: "t",
      fetchImpl: async () => {
        throw new Error("ECONNRESET");
      },
    });
    expect(!result.ok && result.problem.kind).toBe("network");
  });
});
