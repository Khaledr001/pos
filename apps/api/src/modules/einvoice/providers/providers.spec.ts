import { describe, expect, it, vi } from "vitest";
import type { AspSubmission } from "./asp-provider.js";
import { GatewayProvider, parseReply } from "./gateway.provider.js";
import { SandboxProvider } from "./sandbox.provider.js";
import { sign, verifySignature } from "./signature.js";
import { assertSafeUrl, guardedLookup, isPrivateAddress, UnsafeUrlError, type GuardedRequest } from "./ssrf.js";

const submission: AspSubmission = {
  uuid: "f12f329f-6430-4399-b661-7c5cd9c3a9e6",
  docType: "invoice",
  documentNumber: "INV-1",
  issuedAt: "2026-11-03T08:15:30.000Z",
  xml: "<Invoice/>",
  xmlSha256: "abc",
  sandbox: true,
};

describe("isPrivateAddress", () => {
  it.each([
    "10.0.0.1", "10.255.255.255", "127.0.0.1", "127.9.9.9", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "0.0.0.0", "100.64.0.1",
    "224.0.0.1", "255.255.255.255", "192.0.2.5", "198.18.0.1",
    "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe", "2001:db8::1", "64:ff9b::a00:1",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "11.0.0.1", "169.255.0.1", "2606:4700:4700::1111", "2a00:1450:4009:81c::200e", "::ffff:8.8.8.8"])("allows the public address %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("assertSafeUrl", () => {
  it("accepts a plain https URL", () => {
    expect(assertSafeUrl("https://api.provider.example/v1/invoices").hostname).toBe("api.provider.example");
  });

  it.each([
    ["http://api.provider.example/", /https/],
    ["ftp://api.provider.example/", /https/],
    ["https://user:pass@api.provider.example/", /username/],
    ["https://localhost/", /private/],
    ["https://app.localhost/", /private/],
    ["https://db.internal/", /private/],
    ["https://127.0.0.1/", /private/],
    ["https://169.254.169.254/latest/meta-data", /private/],
    ["https://[::1]/", /private/],
    ["https://10.1.2.3:8443/", /private/],
    ["not a url", /valid URL/],
  ])("refuses %s", (url, message) => {
    expect(() => assertSafeUrl(url)).toThrow(UnsafeUrlError);
    expect(() => assertSafeUrl(url)).toThrow(message);
  });

  it("lets a private address through only when explicitly allowed (local development)", () => {
    expect(assertSafeUrl("https://127.0.0.1:9443/", true).hostname).toBe("127.0.0.1");
  });
});

describe("guardedLookup (what the connection actually uses)", () => {
  const callLookup = (answers: { address: string; family: number }[], allowPrivate = false) =>
    new Promise<{ err: Error | null; result: unknown }>((resolve) => {
      const lookup = guardedLookup(allowPrivate, async () => answers) as unknown as (h: string, o: object, cb: (e: Error | null, a?: unknown, f?: number) => void) => void;
      lookup("x.example", { all: true }, (err, result) => resolve({ err, result }));
    });

  it("passes a public answer through", async () => {
    const { err, result } = await callLookup([{ address: "93.184.216.34", family: 4 }]);
    expect(err).toBeNull();
    expect(result).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("refuses a hostname that resolves to a private address (DNS rebinding / internal names)", async () => {
    const { err } = await callLookup([{ address: "10.0.0.5", family: 4 }]);
    expect(err).toBeInstanceOf(UnsafeUrlError);
  });

  it("drops the private answers when a name resolves to both, and keeps the public one", async () => {
    const { result } = await callLookup([{ address: "169.254.169.254", family: 4 }, { address: "93.184.216.34", family: 4 }]);
    expect(result).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });
});

describe("signatures", () => {
  it("round-trips and rejects a changed body, a wrong secret and junk", () => {
    const body = JSON.stringify({ id: "x", status: "delivered" });
    const header = sign(body, "s3cret");
    expect(header).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifySignature(body, header, "s3cret")).toBe(true);
    expect(verifySignature(body + " ", header, "s3cret")).toBe(false);
    expect(verifySignature(body, header, "other")).toBe(false);
    expect(verifySignature(body, undefined, "s3cret")).toBe(false);
    expect(verifySignature(body, "sha256=short", "s3cret")).toBe(false);
    expect(verifySignature(body, header.replace("sha256=", ""), "s3cret")).toBe(false);
  });
});

describe("SandboxProvider", () => {
  it("accepts and confirms delivery, deterministically", async () => {
    const provider = new SandboxProvider();
    expect(await provider.submit(submission)).toEqual({ ok: true, providerRef: `sbx-${submission.uuid}`, status: "delivered" });
    expect((await provider.testConnection()).ok).toBe(true);
  });
});

describe("GatewayProvider", () => {
  const make = (reply: (request: GuardedRequest) => { status: number; body: string } | Error, over: Partial<ConstructorParameters<typeof GatewayProvider>[0]> = {}) => {
    const send = vi.fn(async (request: GuardedRequest) => {
      const r = reply(request);
      if (r instanceof Error) throw r;
      return r;
    });
    return { provider: new GatewayProvider({ endpointUrl: "https://asp.example/v1", credential: "key-123", allowPrivate: false, ...over }, send), send };
  };

  it("posts the documented body with a bearer token and a signature over exactly that body", async () => {
    const { provider, send } = make(() => ({ status: 200, body: JSON.stringify({ id: "asp-1", status: "accepted" }) }));
    const result = await provider.submit(submission);
    expect(result).toEqual({ ok: true, providerRef: "asp-1", status: "submitted" });
    const request = send.mock.calls[0]![0];
    expect(request.method).toBe("POST");
    expect(request.headers?.authorization).toBe("Bearer key-123");
    expect(request.headers?.["x-signature"]).toBe(sign(request.body!, "key-123"));
    const body = JSON.parse(request.body!);
    expect(body).toMatchObject({ uuid: submission.uuid, docType: "invoice", documentNumber: "INV-1", xmlSha256: "abc", sandbox: true });
    expect(Buffer.from(body.xmlBase64, "base64").toString()).toBe("<Invoice/>");
    expect(request.allowPrivate).toBe(false);
  });

  it("reads delivered and rejected replies", async () => {
    expect(await make(() => ({ status: 200, body: '{"id":"a","status":"delivered"}' })).provider.submit(submission)).toMatchObject({ ok: true, status: "delivered" });
    const rejected = await make(() => ({ status: 200, body: JSON.stringify({ id: "a", status: "rejected", errors: [{ code: "IBR-010", message: "Bad buyer" }] }) })).provider.submit(submission);
    expect(rejected).toMatchObject({ ok: false, kind: "rejected", errors: [{ code: "IBR-010", message: "Bad buyer" }], providerRef: "a" });
  });

  it("classifies failures: retry vs final", async () => {
    expect(await make(() => ({ status: 503, body: "" })).provider.submit(submission)).toMatchObject({ ok: false, kind: "retry" });
    expect(await make(() => ({ status: 429, body: "" })).provider.submit(submission)).toMatchObject({ ok: false, kind: "retry" });
    expect(await make(() => new Error("ECONNRESET 10.0.0.5:443")).provider.submit(submission)).toMatchObject({ ok: false, kind: "retry" });
    expect(await make(() => ({ status: 401, body: "" })).provider.submit(submission)).toMatchObject({ ok: false, kind: "permanent" });
    expect(await make(() => ({ status: 302, body: "" })).provider.submit(submission)).toMatchObject({ ok: false, kind: "permanent" });
    expect(await make(() => ({ status: 422, body: '{"errors":[{"code":"X","message":"no"}]}' })).provider.submit(submission)).toMatchObject({ ok: false, kind: "rejected", errors: [{ code: "X", message: "no" }] });
    expect(await make(() => ({ status: 200, body: "<html>oops</html>" })).provider.submit(submission)).toMatchObject({ ok: false, kind: "retry" });
  });

  it("does not leak a transport message into the result, and surfaces a blocked URL as final", async () => {
    const leaked = await make(() => new Error("connect ECONNREFUSED 10.1.2.3:443")).provider.submit(submission);
    expect(JSON.stringify(leaked)).not.toContain("10.1.2.3");
    const blocked = await make(() => new UnsafeUrlError("The address resolves to a private network")).provider.submit(submission);
    expect(blocked).toMatchObject({ ok: false, kind: "permanent" });
  });

  it("refuses to run with no endpoint or no credential", async () => {
    expect(await make(() => ({ status: 200, body: "{}" }), { endpointUrl: null }).provider.submit(submission)).toMatchObject({ kind: "permanent" });
    expect(await make(() => ({ status: 200, body: "{}" }), { credential: null }).provider.submit(submission)).toMatchObject({ kind: "permanent" });
  });

  it("never puts the credential in an error message", async () => {
    const result = await make(() => ({ status: 401, body: "key-123 is wrong" })).provider.submit(submission);
    expect(JSON.stringify(result)).not.toContain("key-123");
  });

  it("tests the connection with a ping", async () => {
    expect((await make(() => ({ status: 200, body: '{"id":"p","status":"accepted"}' })).provider.testConnection()).ok).toBe(true);
    expect((await make(() => ({ status: 401, body: "" })).provider.testConnection()).ok).toBe(false);
  });
});

describe("parseReply", () => {
  it("is strict about shape and never throws", () => {
    expect(parseReply("")).toBeNull();
    expect(parseReply("null")).toBeNull();
    expect(parseReply('{"id":"a","status":"maybe"}')).toBeNull();
    expect(parseReply('{"status":"accepted"}')).toBeNull();
    expect(parseReply('{"id":123,"status":"accepted"}')).toEqual({ id: "123", status: "accepted", errors: [] });
    expect(parseReply(JSON.stringify({ id: "a", status: "rejected", errors: "nope" }))?.errors).toEqual([]);
  });
});
