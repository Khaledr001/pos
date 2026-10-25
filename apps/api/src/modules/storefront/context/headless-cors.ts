import type { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface.js";
import type { StorefrontResolver } from "./storefront-resolver.service.js";

/** The slice of an Express request the delegate reads. */
interface CorsRequest {
  method?: string;
  originalUrl?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * CORS for the whole API, with one addition: a tenant's own front end, listed
 * under its shop's headless settings, may read that shop's public storefront
 * API from the browser.
 *
 * Everything not on the storefront routes behaves exactly as before (the
 * static `API_CORS_ORIGINS` list, with credentials). For a storefront route
 * from any other origin the answer is no unless the shop opted in, and even
 * then credentials stay OFF: shopper cookies are first-party to the hosted
 * shop and must never ride along on a call from someone else's page. Any
 * lookup failure is a no.
 */
export function createCorsDelegate(options: {
  staticOrigins: string[];
  /** The API's global prefix, e.g. "api/v1". */
  prefix: string;
  resolver: Pick<StorefrontResolver, "headlessAllows" | "originAllowedAnywhere">;
}) {
  const base: CorsOptions = {
    origin: options.staticOrigins,
    credentials: true,
    exposedHeaders: ["x-request-id"],
  };
  const storefrontPrefix = `/${options.prefix.replace(/^\/|\/$/g, "")}/storefront/`;

  const headless = (origin: string): CorsOptions => ({
    origin: [origin],
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "x-storefront-host", "idempotency-key", "accept", "accept-language"],
    exposedHeaders: ["x-request-id"],
    maxAge: 600,
  });

  return (request: CorsRequest, callback: (error: Error | null, options: CorsOptions) => void): void => {
    void (async () => {
      const origin = first(request.headers.origin);
      const path = request.originalUrl ?? request.url ?? "";
      if (!origin || options.staticOrigins.includes(origin) || !path.startsWith(storefrontPrefix)) {
        return callback(null, base);
      }
      try {
        const allowed =
          request.method === "OPTIONS"
            ? await options.resolver.originAllowedAnywhere(origin)
            : await options.resolver.headlessAllows(first(request.headers["x-storefront-host"]), origin);
        callback(null, allowed ? headless(origin) : base);
      } catch {
        callback(null, base);
      }
    })();
  };
}
