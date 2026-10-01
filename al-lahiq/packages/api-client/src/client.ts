import type { ApiErrorBody } from './types.ts';

/** Thrown for any non-2xx response. Branch on `code`, not `message`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, body: Partial<ApiErrorBody>) {
    super(body.message ?? `Request failed with ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code ?? 'ERROR';
    this.details = body.details;
  }
}

export interface ApiClientOptions {
  /** e.g. "http://localhost:4000/api/v1" on the server, "/api/v1" in the browser */
  baseUrl: string;
  /** Extra headers per request (cookies forwarded by the Next.js server). */
  headers?: () => HeadersInit | Promise<HeadersInit>;
  fetch?: typeof fetch;
}

type Init = RequestInit & { next?: { tags?: string[]; revalidate?: number | false } };

export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? fetch;

  async function request<T>(method: string, path: string, body?: unknown, init: Init = {}): Promise<T> {
    const headers = new Headers(await options.headers?.());
    new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && !isForm) headers.set('content-type', 'application/json');
    headers.set('accept', 'application/json');

    const res = await doFetch(`${options.baseUrl}${path}`, {
      credentials: 'include',
      ...init,
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new ApiError(res.status, (data ?? {}) as Partial<ApiErrorBody>);
    return data as T;
  }

  return {
    get: <T>(path: string, init?: Init) => request<T>('GET', path, undefined, init),
    post: <T>(path: string, body?: unknown, init?: Init) => request<T>('POST', path, body ?? {}, init),
    patch: <T>(path: string, body?: unknown, init?: Init) => request<T>('PATCH', path, body ?? {}, init),
    put: <T>(path: string, body?: unknown, init?: Init) => request<T>('PUT', path, body ?? {}, init),
    delete: <T = void>(path: string, init?: Init) => request<T>('DELETE', path, undefined, init),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Builds a query string, skipping empty values. Arrays become comma lists. */
export function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) sp.set(key, value.join(','));
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v !== undefined && v !== '') sp.set(`${key}[${k}]`, String(v));
      }
    } else {
      sp.set(key, String(value));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
