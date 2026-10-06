import { ProviderFatalError } from "./types.js";

export interface HttpOptions {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  baseDelayMs?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET JSON with polite retries: 429 and 5xx back off exponentially (honouring
 * Retry-After); 401/402/403 are fatal at once — retrying a bad key or an
 * exhausted quota only burns time.
 */
export async function getJson(
  url: string,
  headers: Record<string, string>,
  options: HttpOptions = {},
  /** For providers that take their query in a POST body. */
  request: { method?: string; body?: string } = {},
): Promise<unknown> {
  const fetchFn = options.fetchFn ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? 4;
  const base = options.baseDelayMs ?? 1500;

  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetchFn(url, { headers, ...request, signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      if (attempt >= maxRetries) throw new Error(`Network error: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(base * 2 ** attempt);
      continue;
    }

    if (response.ok) return response.json();

    if ([401, 402, 403].includes(response.status)) {
      throw new ProviderFatalError(
        `The search provider refused the request (HTTP ${response.status}). Check the API key and that your plan still has quota.`,
      );
    }
    if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : base * 2 ** attempt);
      continue;
    }
    throw new Error(`Search provider answered HTTP ${response.status}`);
  }
}
