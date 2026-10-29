import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { developmentKey, parseEncryptionKey, SecretBox, SecretBoxError } from "./secret-box.js";

describe("SecretBox", () => {
  const box = new SecretBox(developmentKey());

  it("round-trips, including non-ASCII", () => {
    for (const value of ["sk_live_abc123", "", "كلمة السر 🔐", "a".repeat(5000)]) {
      expect(box.decrypt(box.encrypt(value))).toBe(value);
    }
  });

  it("uses a fresh IV, so the same secret never encrypts to the same envelope", () => {
    expect(box.encrypt("same")).not.toBe(box.encrypt("same"));
  });

  it("writes a versioned four-part envelope that does not contain the plaintext", () => {
    const envelope = box.encrypt("super-secret-value");
    expect(envelope.split(":")).toHaveLength(4);
    expect(envelope.startsWith("v1:")).toBe(true);
    expect(envelope).not.toContain("super-secret-value");
  });

  it("refuses a tampered ciphertext, a wrong key and an unknown version", () => {
    const envelope = box.encrypt("secret");
    const [v, iv, tag, ct] = envelope.split(":") as [string, string, string, string];
    const flipped = Buffer.from(ct, "base64url");
    flipped[0] = flipped[0]! ^ 1;
    expect(() => box.decrypt([v, iv, tag, flipped.toString("base64url")].join(":"))).toThrow(SecretBoxError);
    expect(() => new SecretBox(randomBytes(32)).decrypt(envelope)).toThrow(SecretBoxError);
    expect(() => box.decrypt(envelope.replace("v1:", "v9:"))).toThrow(/Unrecognised/);
    expect(() => box.decrypt("garbage")).toThrow(SecretBoxError);
  });

  it("does not echo the secret in its error messages", () => {
    try {
      box.decrypt("v1:AAAA:BBBB:CCCC");
    } catch (error) {
      expect(String(error)).not.toContain("CCCC");
    }
  });

  it("parses a hex or base64 key and rejects anything else", () => {
    const raw = randomBytes(32);
    expect(parseEncryptionKey(raw.toString("hex")).equals(raw)).toBe(true);
    expect(parseEncryptionKey(raw.toString("base64")).equals(raw)).toBe(true);
    expect(parseEncryptionKey(raw.toString("base64url")).equals(raw)).toBe(true);
    expect(() => parseEncryptionKey("too-short")).toThrow(SecretBoxError);
    expect(() => new SecretBox(Buffer.alloc(16))).toThrow(SecretBoxError);
  });
});
