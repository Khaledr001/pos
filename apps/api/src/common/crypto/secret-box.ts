import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encrypts small secrets (an ASP's API key) before they are written to the
 * database, so a leaked backup or a read-only SQL session does not hand over a
 * credential.
 *
 * AES-256-GCM with a fresh random 96-bit IV per value. The envelope is
 * `v1:<iv>:<tag>:<ciphertext>`, each part base64url — the version prefix is how
 * a future key rotation or algorithm change recognises old values instead of
 * failing to decrypt them.
 *
 * GCM authenticates as well as encrypts: a tampered or truncated value throws
 * rather than decrypting to garbage.
 */
const VERSION = "v1";
const KEY_BYTES = 32;

export class SecretBoxError extends Error {}

/** Accepts 64 hex characters, or base64/base64url that decodes to exactly 32 bytes. */
export function parseEncryptionKey(value: string): Buffer {
  const trimmed = value.trim();
  const fromHex = /^[0-9a-fA-F]{64}$/.test(trimmed) ? Buffer.from(trimmed, "hex") : null;
  if (fromHex) return fromHex;
  const fromBase64 = Buffer.from(trimmed.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (fromBase64.length === KEY_BYTES) return fromBase64;
  throw new SecretBoxError("APP_ENCRYPTION_KEY must be 32 bytes, as 64 hex characters or base64. Generate one with: openssl rand -hex 32");
}

/** A key derived from a fixed label — for local development and tests only, never production. */
export function developmentKey(): Buffer {
  return createHash("sha256").update("devsfleet-development-only-encryption-key").digest();
}

export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== KEY_BYTES) throw new SecretBoxError("SecretBox needs a 32-byte key");
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
  }

  decrypt(envelope: string): string {
    const parts = envelope.split(":");
    if (parts.length !== 4 || parts[0] !== VERSION) throw new SecretBoxError("Unrecognised secret format");
    const [, iv, tag, ciphertext] = parts as [string, string, string, string];
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      // Wrong key and tampered value look the same, deliberately: nothing about which is leaked.
      throw new SecretBoxError("The stored secret could not be decrypted");
    }
  }
}
