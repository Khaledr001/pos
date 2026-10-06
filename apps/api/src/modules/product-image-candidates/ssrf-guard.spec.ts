import { ERROR_CODES } from "@devsfleet/shared-utils";
import { describe, expect, it } from "vitest";
import { assertFetchableUrl, assertPublicAddresses, isForbiddenIp } from "./ssrf-guard.js";

describe("isForbiddenIp", () => {
  it.each([
    "127.0.0.1", "127.255.255.254", "0.0.0.0", "10.0.0.1", "10.255.255.255",
    "172.16.0.1", "172.31.255.255", "192.168.0.1", "192.168.255.255",
    "169.254.169.254", "169.254.0.1", "100.64.0.1", "224.0.0.1", "255.255.255.255",
    "198.18.0.1", "192.0.2.1",
    "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.1.2.3", "::ffff:169.254.169.254",
    "64:ff9b::7f00:1", "2002:7f00:1::1", "2001:db8::1", "::127.0.0.1",
  ])("refuses %s", (ip) => {
    expect(isForbiddenIp(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.255.255", "172.32.0.1",
    "11.0.0.1", "192.169.0.1", "169.253.0.1", "100.63.255.255", "100.128.0.1",
    "2606:4700:4700::1111", "2a00:1450:4001:80b::200e", "::ffff:8.8.8.8",
  ])("allows %s", (ip) => {
    expect(isForbiddenIp(ip)).toBe(false);
  });

  it("treats anything unparseable as forbidden", () => {
    for (const bad of ["", "not-an-ip", "999.1.1.1", "1.2.3", "1::2::3"]) expect(isForbiddenIp(bad)).toBe(true);
  });
});

describe("assertFetchableUrl", () => {
  const blockedWith = (url: string) => {
    try {
      assertFetchableUrl(url);
    } catch (error) {
      return (error as { code?: string }).code;
    }
    return undefined;
  };

  it("accepts a normal https image URL", () => {
    expect(assertFetchableUrl("https://cdn.example.com/a/b.jpg?x=1").hostname).toBe("cdn.example.com");
    expect(assertFetchableUrl("https://cdn.example.com:443/a.jpg").hostname).toBe("cdn.example.com");
  });

  it.each([
    "http://example.com/a.jpg",
    "ftp://example.com/a.jpg",
    "file:///etc/passwd",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
    "https://user:pw@example.com/a.jpg",
    "https://user@example.com/a.jpg",
    "https://example.com@127.0.0.1/a.jpg",
    "https://example.com:8443/a.jpg",
    "https://localhost/a.jpg",
    "https://foo.localhost/a.jpg",
    "https://printer.local/a.jpg",
    "https://db.internal/a.jpg",
    "https://127.0.0.1/a.jpg",
    "https://10.0.0.5/a.jpg",
    "https://172.16.4.4/a.jpg",
    "https://192.168.1.1/a.jpg",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/a.jpg",
    "https://[fc00::1]/a.jpg",
    "https://[::ffff:127.0.0.1]/a.jpg",
    // URL normalisation turns these into 127.0.0.1 — the guard must see the result.
    "https://2130706433/a.jpg",
    "https://0x7f.0.0.1/a.jpg",
    "https://017700000001/a.jpg",
    "not a url",
  ])("blocks %s", (url) => {
    expect(blockedWith(url)).toBe(ERROR_CODES.IMAGE_URL_BLOCKED);
  });
});

describe("assertPublicAddresses (DNS result check)", () => {
  it("passes when every record is public", () => {
    expect(() => assertPublicAddresses(["93.184.216.34", "2606:4700::1111"])).not.toThrow();
  });

  it("refuses when a hostname resolves to loopback (DNS rebinding to localhost)", () => {
    expect(() => assertPublicAddresses(["127.0.0.1"])).toThrow(/private or reserved/);
  });

  it("refuses when ONE of several records is private", () => {
    expect(() => assertPublicAddresses(["93.184.216.34", "10.0.0.7"])).toThrow(/private or reserved/);
    expect(() => assertPublicAddresses(["93.184.216.34", "::1"])).toThrow(/private or reserved/);
  });

  it("refuses an empty answer", () => {
    expect(() => assertPublicAddresses([])).toThrow();
  });
});
