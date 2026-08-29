import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.js";
import { calculateDeepSeekCost, DEFAULT_DEEPSEEK_MODEL } from "./deepseek-pricing.js";
import type {
  LlmChatOptions,
  LlmChatResult,
  LlmMessage,
  LlmTool,
  LlmToolCall,
} from "./llm.types.js";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

interface DeepSeekChatResponse {
  model: string;
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
}

/**
 * A chat-completion client for DeepSeek.
 *
 * DeepSeek's API is deliberately OpenAI-compatible — same `/chat/completions`
 * shape, same `tools` function-calling schema — so this is a thin typed
 * `fetch` wrapper rather than a vendored SDK. Pulling in a whole client
 * library to change one base URL and reshape the response once would be the
 * dependency this codebase otherwise avoids (D13, D16: one implementation,
 * not two, and no native/heavy dependency that only saves writing the
 * request by hand).
 *
 * `LLM_PROVIDER` in env still names openai/gemini/anthropic — that enum is
 * the record of an intended future, not working options. Only "deepseek" has
 * a client here; selecting anything else throws `LLM_NOT_CONFIGURED` rather
 * than silently doing nothing. See docs/DECISIONS.md D19.
 *
 * Nothing calls this yet — there is no WhatsApp module, no webhook, no
 * conversation state. It exists to be imported by whatever builds those
 * (Phase 4 / Stage 8), and to be called directly in the meantime.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async chat(options: LlmChatOptions): Promise<LlmChatResult> {
    const provider = this.config.get("LLM_PROVIDER", { infer: true });
    if (provider !== "deepseek") {
      throw new AppError(
        ERROR_CODES.LLM_NOT_CONFIGURED,
        `LLM_PROVIDER is "${provider}", but only "deepseek" has a client implemented.`,
      );
    }

    const apiKey = this.config.get("DEEPSEEK_API_KEY", { infer: true });
    if (!apiKey) {
      throw new AppError(ERROR_CODES.LLM_NOT_CONFIGURED, "DEEPSEEK_API_KEY is not set.");
    }

    const model = this.config.get("LLM_MODEL", { infer: true }) || DEFAULT_DEEPSEEK_MODEL;
    const maxTokens = options.maxTokens ?? this.config.get("LLM_MAX_TOKENS", { infer: true });
    const timeoutMs = this.config.get("LLM_TIMEOUT_MS", { infer: true });

    const requestBody = {
      model,
      messages: options.messages.map(toWireMessage),
      max_tokens: maxTokens,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.tools?.length ? { tools: options.tools.map(toWireTool) } : {}),
      ...(options.toolChoice ? { tool_choice: options.toolChoice } : {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      throw new AppError(
        ERROR_CODES.LLM_REQUEST_FAILED,
        timedOut ? `DeepSeek did not respond within ${timeoutMs}ms` : "Could not reach DeepSeek",
        { cause: error instanceof Error ? error.message : String(error) },
      );
    } finally {
      clearTimeout(timer);
    }

    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      this.logger.error({ status: response.status, body }, "DeepSeek returned an error");
      throw new AppError(ERROR_CODES.LLM_REQUEST_FAILED, `DeepSeek returned ${response.status}`, {
        status: response.status,
        body: body.slice(0, 2000),
      });
    }

    const payload = (await response.json()) as DeepSeekChatResponse;
    const choice = payload.choices[0];
    if (!choice) {
      throw new AppError(ERROR_CODES.LLM_REQUEST_FAILED, "DeepSeek returned no choices");
    }

    const toolCalls: LlmToolCall[] = (choice.message.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: parseToolArguments(call.function.arguments),
    }));

    const usage = payload.usage;
    const promptTokens = usage?.prompt_tokens ?? 0;
    const cacheHitTokens = usage?.prompt_cache_hit_tokens ?? 0;
    // Fall back to "everything not a hit was a miss" for a response that
    // omits the split — better than silently pricing the tokens at zero.
    const cacheMissTokens = usage?.prompt_cache_miss_tokens ?? promptTokens - cacheHitTokens;
    const completionTokens = usage?.completion_tokens ?? 0;

    return {
      content: choice.message.content,
      toolCalls,
      finishReason: choice.finish_reason,
      usage: {
        model: payload.model,
        promptTokens,
        completionTokens,
        totalTokens: usage?.total_tokens ?? promptTokens + completionTokens,
        cacheHitTokens,
        cacheMissTokens,
        estimatedCostUsd: calculateDeepSeekCost({
          model: payload.model,
          cacheHitTokens,
          cacheMissTokens,
          completionTokens,
        }),
        latencyMs,
      },
    };
  }
}

function toWireMessage(message: LlmMessage) {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.name ? { name: message.name } : {}),
  };
}

function toWireTool(tool: LlmTool) {
  return {
    type: "function" as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

/** A malformed arguments string must not crash the caller's turn. */
function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
