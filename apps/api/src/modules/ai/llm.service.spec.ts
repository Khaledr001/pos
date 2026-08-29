import { ERROR_CODES } from "@devsfleet/shared-utils";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env.js";
import { LlmService } from "./llm.service.js";

/**
 * `fetch` is mocked throughout — this proves the request/response mapping,
 * not that DeepSeek's real API behaves as documented. There is no live
 * network call in this suite.
 */
describe("LlmService", () => {
  const config = (overrides: Partial<Env> = {}) => {
    const defaults: Partial<Env> = {
      LLM_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "sk-test-key",
      LLM_MODEL: undefined,
      LLM_MAX_TOKENS: 1024,
      LLM_TIMEOUT_MS: 20000,
    };
    const merged = { ...defaults, ...overrides };
    return { get: (key: keyof Env) => merged[key] } as unknown as ConfigService<Env, true>;
  };

  const buildService = async (overrides: Partial<Env> = {}) => {
    const moduleRef = await Test.createTestingModule({
      providers: [LlmService, { provide: ConfigService, useValue: config(overrides) }],
    }).compile();
    return moduleRef.get(LlmService);
  };

  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses to call an unimplemented provider", async () => {
    const service = await buildService({ LLM_PROVIDER: "openai" });

    await expect(service.chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject(
      { code: ERROR_CODES.LLM_NOT_CONFIGURED },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to call DeepSeek with no API key configured", async () => {
    const service = await buildService({ DEEPSEEK_API_KEY: undefined });

    await expect(service.chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject(
      { code: ERROR_CODES.LLM_NOT_CONFIGURED },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the bearer token, the resolved model, and an OpenAI-shaped body", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "deepseek-v4-flash",
          choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200 },
      ),
    );
    const service = await buildService();

    await service.chat({ messages: [{ role: "user", content: "hi" }] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init.headers.authorization).toBe("Bearer sk-test-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("deepseek-v4-flash"); // LLM_MODEL unset -> the default
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("falls back to the default model only when LLM_MODEL is blank", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "deepseek-v4-pro",
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        }),
        { status: 200 },
      ),
    );
    const service = await buildService({ LLM_MODEL: "deepseek-v4-pro" });

    await service.chat({ messages: [{ role: "user", content: "hi" }] });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.model).toBe("deepseek-v4-pro");
  });

  it("maps content, usage, and cost from a plain text reply", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "deepseek-v4-flash",
          choices: [{ message: { content: "The 1-inch elbow is AED 3.50." }, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 500,
            completion_tokens: 20,
            total_tokens: 520,
            prompt_cache_hit_tokens: 100,
            prompt_cache_miss_tokens: 400,
          },
        }),
        { status: 200 },
      ),
    );
    const service = await buildService();

    const result = await service.chat({ messages: [{ role: "user", content: "price of the elbow?" }] });

    expect(result.content).toBe("The 1-inch elbow is AED 3.50.");
    expect(result.toolCalls).toEqual([]);
    expect(result.finishReason).toBe("stop");
    expect(result.usage.promptTokens).toBe(500);
    expect(result.usage.completionTokens).toBe(20);
    expect(result.usage.cacheHitTokens).toBe(100);
    expect(result.usage.cacheMissTokens).toBe(400);
    // Cost is a real, positive decimal string — the exact value is
    // deepseek-pricing.spec.ts's job to pin down.
    expect(Number(result.usage.estimatedCostUsd)).toBeGreaterThan(0);
  });

  it("parses tool calls and their JSON arguments", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "deepseek-v4-flash",
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    function: { name: "check_stock", arguments: '{"sku":"ELB-1IN","branchId":"b1"}' },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 200, completion_tokens: 10, total_tokens: 210 },
        }),
        { status: 200 },
      ),
    );
    const service = await buildService();

    const result = await service.chat({
      messages: [{ role: "user", content: "do you have the elbow?" }],
      tools: [{ name: "check_stock", description: "Check stock", parameters: { type: "object" } }],
    });

    expect(result.content).toBeNull();
    expect(result.toolCalls).toEqual([
      { id: "call_1", name: "check_stock", arguments: { sku: "ELB-1IN", branchId: "b1" } },
    ]);

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.tools).toEqual([
      { type: "function", function: { name: "check_stock", description: "Check stock", parameters: { type: "object" } } },
    ]);
  });

  it("does not crash on a malformed tool-call arguments string", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "deepseek-v4-flash",
          choices: [
            {
              message: {
                content: null,
                tool_calls: [{ id: "call_1", function: { name: "x", arguments: "{not json" } }],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const service = await buildService();

    const result = await service.chat({ messages: [{ role: "user", content: "hi" }] });

    expect(result.toolCalls[0]!.arguments).toEqual({});
  });

  it("raises LLM_REQUEST_FAILED on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));
    const service = await buildService();

    await expect(service.chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject(
      { code: ERROR_CODES.LLM_REQUEST_FAILED },
    );
  });

  it("raises LLM_REQUEST_FAILED, naming the timeout, when the request aborts", async () => {
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const service = await buildService({ LLM_TIMEOUT_MS: 5 });

    await expect(service.chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject(
      { code: ERROR_CODES.LLM_REQUEST_FAILED, message: expect.stringContaining("5ms") },
    );
  });
});
