import { describe, expect, it } from "vitest";
import { dedupeByWaId, groupByCustomer, parseContactSync, parseEchoes, parseHistory } from "./coexistence.js";

const NOW = new Date("2026-10-22T10:00:00Z");

describe("parseEchoes", () => {
  it("turns a message staff sent from the phone into an outbound row to the customer", () => {
    const rows = parseEchoes(
      {
        metadata: { phone_number_id: "1", display_phone_number: "971501111111" },
        message_echoes: [
          { from: "971501111111", to: "971559999999", id: "wamid.E1", timestamp: "1761127200", type: "text", text: { body: "On its way" } },
        ],
      },
      NOW,
    );
    expect(rows).toEqual([
      {
        customerPhone: "971559999999",
        waMessageId: "wamid.E1",
        direction: "outbound",
        type: "text",
        content: "On its way",
        occurredAt: new Date(1761127200 * 1000),
      },
    ]);
  });

  it("skips an echo with no recipient or id, keeping the rest", () => {
    const rows = parseEchoes({ message_echoes: [{ id: "x", type: "text" }, { to: "1", type: "text" }, { id: "ok", to: "971" }] }, NOW);
    expect(rows.map((r) => r.waMessageId)).toEqual(["ok"]);
  });

  it("labels a non-text echo and maps unknown types to unsupported", () => {
    const [img, odd] = parseEchoes({ message_echoes: [{ id: "a", to: "1", type: "image" }, { id: "b", to: "1", type: "reaction" }] }, NOW);
    expect(img).toMatchObject({ type: "image", content: "[image]", occurredAt: NOW });
    expect(odd).toMatchObject({ type: "unsupported", content: "[reaction]" });
  });

  it("ignores a payload that is not an echo at all", () => {
    expect(parseEchoes("nonsense")).toEqual([]);
  });
});

describe("parseHistory", () => {
  const chunk = {
    history: [
      {
        metadata: { phase: 0, chunk_order: 1, progress: 40 },
        threads: [
          {
            id: "971559999999",
            messages: [
              { from: "971559999999", id: "wamid.H1", timestamp: "1700000000", type: "text", text: { body: "Price for 2.5mm cable?" } },
              { from: "971501111111", id: "wamid.H2", timestamp: "1700000100", type: "text", text: { body: "AED 245 a roll" } },
            ],
          },
        ],
      },
    ],
  };

  it("works out direction from the business's own number", () => {
    const { messages, progress } = parseHistory(chunk, "+971 50 111 1111", NOW);
    expect(progress).toBe(40);
    expect(messages.map((m) => [m.waMessageId, m.direction, m.customerPhone])).toEqual([
      ["wamid.H1", "inbound", "971559999999"],
      ["wamid.H2", "outbound", "971559999999"],
    ]);
  });

  it("falls back to the thread's customer when the business number is unknown", () => {
    const { messages } = parseHistory(chunk, null, NOW);
    expect(messages.map((m) => m.direction)).toEqual(["inbound", "outbound"]);
  });

  it("reports a declined history share instead of importing nothing silently", () => {
    const r = parseHistory({ history: [{ errors: [{ code: 2593109, title: "History sharing declined" }] }] }, "1", NOW);
    expect(r.errors).toEqual(["History sharing declined"]);
    expect(r.messages).toEqual([]);
  });
});

describe("parseContactSync", () => {
  it("keeps named additions and drops removals", () => {
    const names = parseContactSync({
      state_sync: [
        { type: "contact", action: "add", contact: { full_name: "Ahmed Ali", phone_number: "+971 55 999 9999" } },
        { type: "contact", action: "remove", contact: { full_name: "Gone", phone_number: "971" } },
        { type: "contact", action: "add", contact: { phone_number: "971" } },
      ],
    });
    expect(names).toEqual([{ phone: "971559999999", name: "Ahmed Ali" }]);
  });
});

describe("idempotency helpers", () => {
  const m = (id: string, phone: string, at: number) => ({
    customerPhone: phone,
    waMessageId: id,
    direction: "inbound" as const,
    type: "text" as const,
    content: null,
    occurredAt: new Date(at),
  });

  it("keeps the first copy of a message Meta repeated", () => {
    expect(dedupeByWaId([m("a", "1", 1), m("a", "1", 2), m("b", "1", 3)]).map((x) => x.occurredAt.getTime())).toEqual([1, 3]);
  });

  it("groups by customer, oldest first", () => {
    const groups = groupByCustomer([m("a", "1", 30), m("b", "2", 10), m("c", "1", 20)]);
    expect([...groups.get("1")!].map((x) => x.waMessageId)).toEqual(["c", "a"]);
    expect(groups.size).toBe(2);
  });
});
