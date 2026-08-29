/**
 * Provider-agnostic chat-completion shapes.
 *
 * Only DeepSeek has a client behind these today (`llm.service.ts`), but the
 * types are not named after it. A second provider should be able to return
 * the same shapes without every caller learning a new one — DeepSeek's own
 * wire format is already OpenAI-compatible, so there is nothing DeepSeek-
 * specific worth leaking into this contract.
 */

export type LlmRole = "system" | "user" | "assistant" | "tool";

export interface LlmMessage {
  role: LlmRole;
  /** Null when an assistant turn is pure tool calls, with no reply text. */
  content: string | null;
  /** Set only on a `role: "tool"` message, echoing which call this answers. */
  toolCallId?: string;
  /** Set only on a `role: "tool"` message: the function name that was invoked. */
  name?: string;
}

/** A function the model may call. `parameters` is a JSON Schema object. */
export interface LlmTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  /** Parsed from the model's JSON string — callers never see raw JSON. */
  arguments: Record<string, unknown>;
}

export interface LlmChatOptions {
  messages: LlmMessage[];
  tools?: LlmTool[];
  toolChoice?: "auto" | "none" | "required";
  maxTokens?: number;
  temperature?: number;
}

export interface LlmUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** 0 for a provider that doesn't report prompt caching. */
  cacheHitTokens: number;
  cacheMissTokens: number;
  /**
   * USD, to 6dp — NOT a `Money` value. `Money` is scaled to 4dp for
   * tenant-facing documents (D5), and a single chat completion routinely
   * costs a few thousandths of a cent: at 4dp every call would show as
   * "0.0000". This is an operator-facing spend estimate, not a ledger entry
   * a customer will ever see, so the precision constraint that justifies
   * `Money` doesn't apply.
   */
  estimatedCostUsd: string;
  latencyMs: number;
}

export interface LlmChatResult {
  /** Null when the model's entire turn was tool calls. */
  content: string | null;
  toolCalls: LlmToolCall[];
  finishReason: string;
  usage: LlmUsage;
}
