import { Test } from "@nestjs/testing";
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { WhatsappWebhookSchema } from "./dto.js";
import { WhatsappService } from "./whatsapp.service.js";

/**
 * The webhook is `@Public()` — Meta carries no bearer token — so the HMAC is
 * the only thing between the internet and this endpoint. These tests are
 * about that boundary and about the envelope parsing; the persistence path is
 * exercised against a real database.
 */
describe("WhatsappService", () => {
  const SECRET = "my-app-secret";
  let service: WhatsappService;
  let accounts: Array<{ verifyToken: string }>;

  const sign = (body: string, secret = SECRET) =>
    `sha256=${createHmac("sha256", secret).update(Buffer.from(body)).digest("hex")}`;

  beforeEach(async () => {
    accounts = [{ verifyToken: "the-right-token" }];

    const selectChain = () => {
      const c: Record<string, unknown> = {};
      for (const m of ["from", "where"]) c[m] = vi.fn(() => c);
      (c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(accounts);
      return c;
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WhatsappService,
        {
          provide: TenantDatabase,
          useValue: {
            runAsPlatformAdmin: (fn: (t: unknown) => unknown) =>
              fn({ select: vi.fn(selectChain) }),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(WhatsappService);
  });

  describe("verifySignature", () => {
    const body = Buffer.from('{"object":"whatsapp_business_account"}');

    it("accepts a signature made with the account's own secret", () => {
      expect(service.verifySignature(body, sign(body.toString()), SECRET)).toBe(true);
    });

    it("rejects a signature made with a different secret", () => {
      expect(
        service.verifySignature(body, sign(body.toString(), "someone-elses-secret"), SECRET),
      ).toBe(false);
    });

    it("rejects a body that was altered after signing", () => {
      const signature = sign(body.toString());
      const tampered = Buffer.from('{"object":"whatsapp_business_account","evil":1}');
      expect(service.verifySignature(tampered, signature, SECRET)).toBe(false);
    });

    it("rejects a missing header, an empty one, and one with no sha256= prefix", () => {
      const valid = sign(body.toString()).slice("sha256=".length);
      expect(service.verifySignature(body, undefined, SECRET)).toBe(false);
      expect(service.verifySignature(body, "", SECRET)).toBe(false);
      expect(service.verifySignature(body, valid, SECRET)).toBe(false);
    });

    it("rejects a truncated signature rather than matching on a prefix", () => {
      const valid = sign(body.toString());
      expect(service.verifySignature(body, valid.slice(0, 20), SECRET)).toBe(false);
    });
  });

  describe("verifySubscription", () => {
    it("echoes the token back when it matches an active account", async () => {
      await expect(service.verifySubscription("subscribe", "the-right-token")).resolves.toBe(
        "the-right-token",
      );
    });

    it("refuses a token no account holds", async () => {
      await expect(service.verifySubscription("subscribe", "guessed")).resolves.toBeNull();
    });

    it("refuses anything that is not a subscribe handshake", async () => {
      await expect(service.verifySubscription("unsubscribe", "the-right-token")).resolves.toBeNull();
      await expect(service.verifySubscription(undefined, "the-right-token")).resolves.toBeNull();
      await expect(service.verifySubscription("subscribe", undefined)).resolves.toBeNull();
    });
  });

  describe("extractValues", () => {
    it("flattens every change across every entry", () => {
      const payload = WhatsappWebhookSchema.parse({
        object: "whatsapp_business_account",
        entry: [
          {
            id: "A",
            changes: [
              { field: "messages", value: { metadata: { phone_number_id: "PN1" } } },
              { field: "messages", value: { metadata: { phone_number_id: "PN2" } } },
            ],
          },
          { id: "B", changes: [{ field: "messages", value: { metadata: { phone_number_id: "PN3" } } }] },
        ],
      });

      expect(service.extractValues(payload).map((v) => v.metadata?.phone_number_id)).toEqual([
        "PN1",
        "PN2",
        "PN3",
      ]);
    });

    it("survives an envelope with no entries, changes, or values", () => {
      expect(service.extractValues(WhatsappWebhookSchema.parse({}))).toEqual([]);
      expect(service.extractValues(WhatsappWebhookSchema.parse({ entry: [] }))).toEqual([]);
      expect(
        service.extractValues(WhatsappWebhookSchema.parse({ entry: [{ id: "A" }] })),
      ).toEqual([]);
    });
  });

  describe("the webhook envelope schema", () => {
    /**
     * Meta ships new fields and event types without warning. A schema that
     * rejected them would 400, and Meta retries a non-200 — turning one
     * unrecognised payload into an endless retry loop and eventually a
     * disabled subscription.
     */
    it("accepts an unfamiliar payload instead of rejecting it", () => {
      const result = WhatsappWebhookSchema.safeParse({
        object: "whatsapp_business_account",
        entry: [
          {
            id: "A",
            changes: [
              {
                field: "some_future_field",
                value: {
                  metadata: { phone_number_id: "PN1" },
                  something_new: { nested: true },
                },
              },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("accepts a status-only notification, which carries no messages", () => {
      const result = WhatsappWebhookSchema.safeParse({
        entry: [
          {
            changes: [
              { value: { metadata: { phone_number_id: "PN1" }, statuses: [{ status: "delivered" }] } },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
      expect(result.success && service.extractValues(result.data)[0]?.messages).toBeUndefined();
    });
  });
});
