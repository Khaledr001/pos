import type { MessageType } from "@devsfleet/shared-types";
import { z } from "zod";

/**
 * Turning a coexistence number's extra webhooks into message rows.
 *
 * A coexistence number is also live in the WhatsApp Business app on the
 * owner's phone. Meta then sends three things the API alone never would:
 * echoes of what staff typed on the phone, the phone's past chats, and its
 * contacts. Pure functions — no database — so the shapes, which are Meta's
 * and change, are pinned down by specs. Field names: see meta-embedded.ts.
 *
 * Every parser is forgiving. An item it cannot read is skipped, not thrown:
 * the webhook must answer 200 regardless, and one malformed message must not
 * cost the rest of a history chunk.
 */

export interface ParsedMessage {
  /** The customer's number as Meta sends it (digits, no "+"). */
  customerPhone: string;
  waMessageId: string;
  direction: "inbound" | "outbound";
  type: MessageType;
  content: string | null;
  occurredAt: Date;
}

const KNOWN_TYPES = new Set<MessageType>(["text", "image", "document", "audio", "video", "location", "template", "interactive"]);

const RawMessage = z.object({
  id: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
  timestamp: z.string().optional(),
  type: z.string().optional(),
  text: z.object({ body: z.string() }).partial().optional(),
});
type RawMessage = z.infer<typeof RawMessage>;

const digits = (value: string | undefined | null) => (value ?? "").replace(/\D/g, "");

function toType(type: string | undefined): MessageType {
  const t = (type ?? "text") as MessageType;
  return KNOWN_TYPES.has(t) ? t : "unsupported";
}

/** Meta sends unix seconds as a string; a missing or garbled one is "now" rather than 1970. */
function toDate(timestamp: string | undefined, now: Date): Date {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : now;
}

/** A caption or body for display; non-text messages keep a short placeholder so the thread still reads. */
function contentOf(message: RawMessage): string | null {
  if (message.text?.body) return message.text.body;
  return message.type && message.type !== "text" ? `[${message.type}]` : null;
}

/**
 * `smb_message_echoes`: messages staff sent from the phone app. Outbound,
 * to `to`. Without a recipient there is no conversation to put it in.
 */
export function parseEchoes(value: unknown, now = new Date()): ParsedMessage[] {
  const echoes = z.object({ message_echoes: z.array(z.unknown()).optional() }).safeParse(value);
  if (!echoes.success) return [];
  const rows: ParsedMessage[] = [];
  for (const item of echoes.data.message_echoes ?? []) {
    const m = RawMessage.safeParse(item);
    if (!m.success || !digits(m.data.to)) continue;
    rows.push({
      customerPhone: digits(m.data.to),
      waMessageId: m.data.id,
      direction: "outbound",
      type: toType(m.data.type),
      content: contentOf(m.data),
      occurredAt: toDate(m.data.timestamp, now),
    });
  }
  return rows;
}

export interface HistoryChunk {
  messages: ParsedMessage[];
  /** Meta's progress through the import, 0–100, when it says. */
  progress: number | null;
  /** The owner declined to share history, or Meta could not produce it. */
  errors: string[];
}

/**
 * `history`: past chats from the phone app, a chunk at a time. A thread's
 * `id` is the customer; a message `from` the business's own number is one
 * the shop sent.
 */
export function parseHistory(value: unknown, businessPhone: string | null | undefined, now = new Date()): HistoryChunk {
  const Thread = z.object({ id: z.string().optional(), messages: z.array(z.unknown()).optional() });
  const Entry = z.object({
    metadata: z.object({ progress: z.union([z.number(), z.string()]).optional() }).partial().optional(),
    threads: z.array(z.unknown()).optional(),
    errors: z.array(z.object({ title: z.string().optional(), message: z.string().optional(), code: z.number().optional() }).partial()).optional(),
  });
  const parsed = z.object({ history: z.array(z.unknown()).optional() }).safeParse(value);
  const chunk: HistoryChunk = { messages: [], progress: null, errors: [] };
  if (!parsed.success) return chunk;

  const business = digits(businessPhone);
  for (const rawEntry of parsed.data.history ?? []) {
    const entry = Entry.safeParse(rawEntry);
    if (!entry.success) continue;
    const progress = Number(entry.data.metadata?.progress);
    if (Number.isFinite(progress)) chunk.progress = progress;
    for (const e of entry.data.errors ?? []) chunk.errors.push(e.message || e.title || `Error ${e.code ?? "unknown"}`);

    for (const rawThread of entry.data.threads ?? []) {
      const thread = Thread.safeParse(rawThread);
      if (!thread.success) continue;
      const customer = digits(thread.data.id);
      for (const rawMessage of thread.data.messages ?? []) {
        const m = RawMessage.safeParse(rawMessage);
        if (!m.success) continue;
        const from = digits(m.data.from);
        // From the business's own number, or not from the customer the thread is about.
        const outbound = business ? from === business : Boolean(from && customer && from !== customer);
        const customerPhone = customer || (outbound ? digits(m.data.to) : from);
        if (!customerPhone) continue;
        chunk.messages.push({
          customerPhone,
          waMessageId: m.data.id,
          direction: outbound ? "outbound" : "inbound",
          type: toType(m.data.type),
          content: contentOf(m.data),
          occurredAt: toDate(m.data.timestamp, now),
        });
      }
    }
  }
  return chunk;
}

export interface ContactName {
  phone: string;
  name: string;
}

/** `smb_app_state_sync`: the phone's contacts. Only additions with a name are useful here. */
export function parseContactSync(value: unknown): ContactName[] {
  const Item = z.object({
    type: z.string().optional(),
    action: z.string().optional(),
    contact: z.object({ full_name: z.string(), first_name: z.string(), phone_number: z.string() }).partial().optional(),
  });
  const parsed = z.object({ state_sync: z.array(z.unknown()).optional() }).safeParse(value);
  if (!parsed.success) return [];
  const names: ContactName[] = [];
  for (const raw of parsed.data.state_sync ?? []) {
    const item = Item.safeParse(raw);
    if (!item.success || (item.data.type && item.data.type !== "contact") || item.data.action === "remove") continue;
    const phone = digits(item.data.contact?.phone_number);
    const name = (item.data.contact?.full_name || item.data.contact?.first_name || "").trim();
    if (phone && name) names.push({ phone, name: name.slice(0, 255) });
  }
  return names;
}

/** Messages grouped by customer, oldest first — one conversation upsert per group. */
export function groupByCustomer(messages: ParsedMessage[]): Map<string, ParsedMessage[]> {
  const groups = new Map<string, ParsedMessage[]>();
  for (const m of messages) {
    const list = groups.get(m.customerPhone) ?? [];
    list.push(m);
    groups.set(m.customerPhone, list);
  }
  for (const list of groups.values()) list.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return groups;
}

/** The same message twice in one chunk (Meta repeats across chunks too) is stored once. */
export function dedupeByWaId(messages: ParsedMessage[]): ParsedMessage[] {
  const seen = new Set<string>();
  return messages.filter((m) => (seen.has(m.waMessageId) ? false : (seen.add(m.waMessageId), true)));
}
