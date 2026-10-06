import { z } from "zod";

/**
 * Minimal authenticated client for the DevsFleet API, using the same staff
 * credentials as the admin panel. Both CLIs go through the API rather than the
 * database so every rule (permissions, RLS, checksum dedup, SSRF guard) is the
 * one the admin panel is subject to.
 */

export interface ApiConfig {
  baseUrl: string;
  email: string;
  password: string;
  tenantSlug?: string | undefined;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const email = env.DEVSFLEET_EMAIL ?? "admin@devsfleet.com";
  const password = env.DEVSFLEET_PASSWORD;
  if (!password) {
    throw new Error(
      "DEVSFLEET_PASSWORD is not set. Export the admin panel login the tool should use:\n" +
        "  export DEVSFLEET_API_URL=http://localhost:3001/api/v1   (default)\n" +
        "  export DEVSFLEET_EMAIL=you@shop.com                      (default admin@devsfleet.com)\n" +
        "  export DEVSFLEET_PASSWORD=...\n" +
        "  export DEVSFLEET_TENANT=<tenant slug>                    (only if your login needs one)",
    );
  }
  return {
    baseUrl: (env.DEVSFLEET_API_URL ?? "http://localhost:3001/api/v1").replace(/\/$/, ""),
    email,
    password,
    tenantSlug: env.DEVSFLEET_TENANT,
  };
}

const ProductSchema = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  brandName: z.string().nullable().optional(),
  categoryName: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
});
export type ApiProduct = z.infer<typeof ProductSchema>;

const EnvelopeSchema = z.object({ success: z.boolean(), data: z.unknown(), error: z.object({ code: z.string(), message: z.string() }).optional(), meta: z.object({ totalPages: z.number() }).optional() });

export interface CandidateSubmission {
  productId: string;
  imageUrl: string;
  thumbnailUrl?: string;
  sourcePageUrl: string;
  title?: string;
  width?: number;
  height?: number;
  matchScore: number;
  query: string;
}

export class ApiClient {
  private token: string | null = null;

  constructor(
    private readonly config: ApiConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async login(): Promise<void> {
    const res = await this.fetchFn(`${this.config.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: this.config.email, password: this.config.password, tenantSlug: this.config.tenantSlug }),
    });
    const body = EnvelopeSchema.parse(await res.json());
    const token = z.object({ accessToken: z.string() }).safeParse(body.data);
    if (!body.success || !token.success) throw new Error(`Login failed: ${body.error?.message ?? res.status}`);
    this.token = token.data.accessToken;
  }

  private async request(path: string, init: RequestInit & { json?: unknown } = {}): Promise<z.infer<typeof EnvelopeSchema>> {
    if (!this.token) await this.login();
    const send = () => {
      const { json, ...rest } = init;
      return this.fetchFn(`${this.config.baseUrl}${path}`, {
        ...rest,
        headers: {
          ...(json !== undefined ? { "content-type": "application/json" } : {}),
          authorization: `Bearer ${this.token}`,
        },
        ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
      });
    };
    let res = await send();
    if (res.status === 401) {
      // Access tokens last minutes; a long run must renew rather than die.
      await this.login();
      res = await send();
    }
    const body = EnvelopeSchema.parse(await res.json());
    if (!body.success) throw new Error(`${path}: ${body.error?.code ?? res.status} ${body.error?.message ?? ""}`.trim());
    return body;
  }

  async listProducts(): Promise<ApiProduct[]> {
    const all: ApiProduct[] = [];
    for (let page = 1; ; page += 1) {
      const body = await this.request(`/products?limit=200&page=${page}&sortBy=name`);
      const rows = Array.isArray(body.data) ? body.data : (z.object({ items: z.array(z.unknown()) }).parse(body.data).items);
      all.push(...rows.map((r) => ProductSchema.parse(r)));
      if (page >= (body.meta?.totalPages ?? 1)) break;
    }
    return all;
  }

  async submitCandidates(candidates: CandidateSubmission[]): Promise<{ inserted: number; skipped: number; unknownProducts: string[] }> {
    const body = await this.request("/product-image-candidates/bulk", { method: "POST", json: { candidates } });
    return z.object({ inserted: z.number(), skipped: z.number(), unknownProducts: z.array(z.string()) }).parse(body.data);
  }

  /** Multipart upload to the existing product-image endpoint. Returns "stored" or "duplicate". */
  async uploadImage(
    productId: string,
    file: { bytes: Uint8Array; filename: string; mimeType: string },
    attribution: { source: string; altText: string },
  ): Promise<"stored" | "duplicate"> {
    if (!this.token) await this.login();
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(file.bytes)], { type: file.mimeType }), file.filename);
    form.append("source", attribution.source);
    form.append("altText", attribution.altText.slice(0, 255));
    const send = () =>
      this.fetchFn(`${this.config.baseUrl}/products/${productId}/images`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}` },
        body: form,
      });
    let res = await send();
    if (res.status === 401) {
      await this.login();
      res = await send();
    }
    const body = EnvelopeSchema.parse(await res.json());
    if (body.success) return "stored";
    if (body.error?.code === "DUPLICATE_IMAGE") return "duplicate";
    throw new Error(`upload failed: ${body.error?.code ?? res.status} ${body.error?.message ?? ""}`.trim());
  }
}
