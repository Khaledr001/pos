import type { AspCallback, AspError, AspProvider, AspResult, AspSubmission } from "./asp-provider.js";
import { sign } from "./signature.js";
import { sendGuarded, UnsafeUrlError, type HttpsSender } from "./ssrf.js";

/**
 * The generic HTTPS connector. Real accredited providers each publish their own
 * API; this is the slot a connector for one of them replaces — and, until then, a
 * documented contract a provider (or a small adapter in front of one) can meet.
 * See docs/EINVOICING.md "Provider contract".
 *
 * POST <endpointUrl>   Authorization: Bearer <credential>
 *                      X-Signature: sha256=<hex HMAC-SHA256 of the raw body, key = credential>
 *   { uuid, docType, documentNumber, issuedAt, xmlBase64, xmlSha256, sandbox }
 * 2xx →  { id, status: "accepted" | "delivered" | "rejected", errors?: [{code, message}] }
 */
export class GatewayProvider implements AspProvider {
  readonly name = "gateway" as const;

  constructor(
    private readonly options: { endpointUrl: string | null; credential: string | null; allowPrivate: boolean },
    private readonly send: HttpsSender = sendGuarded,
  ) {}

  async submit(s: AspSubmission): Promise<AspResult> {
    const body = JSON.stringify({
      uuid: s.uuid,
      docType: s.docType,
      documentNumber: s.documentNumber,
      issuedAt: s.issuedAt,
      xmlBase64: Buffer.from(s.xml, "utf8").toString("base64"),
      xmlSha256: s.xmlSha256,
      sandbox: s.sandbox,
    });
    return this.call(body);
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const result = await this.call(JSON.stringify({ type: "ping" }));
    if (result.ok) return { ok: true, message: "The provider answered." };
    if (result.kind === "rejected") return { ok: true, message: "The provider answered (it declined the test message, which is expected)." };
    return { ok: false, message: result.message };
  }

  private async call(body: string): Promise<AspResult> {
    const { endpointUrl, credential, allowPrivate } = this.options;
    if (!endpointUrl) return { ok: false, kind: "permanent", message: "No provider endpoint is configured." };
    if (!credential) return { ok: false, kind: "permanent", message: "No provider credentials are stored." };

    let response;
    try {
      response = await this.send({
        url: endpointUrl,
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${credential}`, "x-signature": sign(body, credential) },
        body,
        allowPrivate,
      });
    } catch (error) {
      if (error instanceof UnsafeUrlError) return { ok: false, kind: "permanent", message: `The provider endpoint was refused: ${error.message}.` };
      // Never echo the transport's message verbatim into the document: it can name an internal host.
      return { ok: false, kind: "retry", message: "Could not reach the provider (network error or timeout)." };
    }

    const { status } = response;
    if (status === 401 || status === 403) return { ok: false, kind: "permanent", message: `The provider refused the credentials (HTTP ${status}).` };
    if (status === 408 || status === 429 || status >= 500) return { ok: false, kind: "retry", message: `The provider is unavailable (HTTP ${status}).` };
    if (status >= 300 && status < 400) return { ok: false, kind: "permanent", message: "The provider endpoint redirected, which is not followed." };

    if (status >= 400) {
      const errors = errorsFromBody(response.body);
      return { ok: false, kind: "rejected", errors: errors.length ? errors : [{ code: `HTTP_${status}`, message: `The provider rejected the document (HTTP ${status}).` }] };
    }
    const parsed = parseReply(response.body);
    if (!parsed) return { ok: false, kind: "retry", message: "The provider's reply was not understood." };
    if (parsed.status === "rejected") return { ok: false, kind: "rejected", errors: parsed.errors.length ? parsed.errors : [{ code: "REJECTED", message: "The provider rejected the document." }], providerRef: parsed.id };
    return { ok: true, providerRef: parsed.id, status: parsed.status === "delivered" ? "delivered" : "submitted" };
  }
}

/** Reads the provider's JSON reply; anything unexpected is null, never a throw. */
export function parseReply(text: string): { id: string; status: "accepted" | "delivered" | "rejected"; errors: AspError[] } | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const v = value as { id?: unknown; status?: unknown; errors?: unknown };
  const id = typeof v.id === "string" && v.id.trim() ? v.id.trim().slice(0, 200) : typeof v.id === "number" ? String(v.id) : null;
  if (!id || (v.status !== "accepted" && v.status !== "delivered" && v.status !== "rejected")) return null;
  return { id, status: v.status, errors: parseErrors(v.errors) };
}

/** The `errors` array of a JSON error body, whatever else it does or does not contain. */
export function errorsFromBody(text: string): AspError[] {
  try {
    const value = JSON.parse(text) as { errors?: unknown } | null;
    return value && typeof value === "object" ? parseErrors(value.errors) : [];
  } catch {
    return [];
  }
}

export function parseErrors(raw: unknown): AspError[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 50)
    .map((e) => (e && typeof e === "object" ? (e as { code?: unknown; message?: unknown }) : {}))
    .map((e) => ({ code: String(e.code ?? "PROVIDER_ERROR").slice(0, 60), message: String(e.message ?? "The provider reported a problem.").slice(0, 500) }));
}

export type { AspCallback };
