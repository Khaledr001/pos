import { type ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { createHash, timingSafeEqual } from "node:crypto";

/** Hashed once, so the comparison is fixed-length and constant-time. */
const digest = (value: string) => createHash("sha256").update(value).digest();
const proxySecret = process.env.STOREFRONT_PROXY_SECRET ? digest(process.env.STOREFRONT_PROXY_SECRET) : null;

/**
 * Rate limiting that counts shoppers, not the storefront server.
 *
 * Every storefront request reaches this API from the storefront's own
 * server — its server-side renders and the browser's proxied /api/v1 calls
 * alike — so keyed on `req.ip` the whole shop shares one bucket, and a busy
 * afternoon becomes a wall of 429s.
 *
 * The storefront therefore names the shopper's IP in `x-storefront-client-ip`
 * and proves it is the storefront with `x-storefront-proxy`, a shared secret.
 * Without a matching secret the header is ignored and `req.ip` decides, so
 * nobody else can choose which IP they are limited as.
 */
@Injectable()
export class StorefrontAwareThrottlerGuard extends ThrottlerGuard {
  /**
   * The storefront's cached catalogue reads carry the secret but no shopper
   * IP — Next keys its fetch cache on request headers, so a per-visitor
   * header would give every visitor a private copy of the catalogue. Those
   * reads are bounded by that cache rather than by this guard.
   */
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ headers?: Record<string, unknown> }>();
    if (isStorefront(req.headers) && !clientIpOf(req.headers)) return true;
    return super.shouldSkip(context);
  }

  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const clientIp = clientIpOf(req.headers);
    if (clientIp && isStorefront(req.headers)) return `shopper:${clientIp}`;
    return super.getTracker(req);
  }
}

function isStorefront(headers: Record<string, unknown> | undefined): boolean {
  const claimed = headers?.["x-storefront-proxy"];
  return !!proxySecret && typeof claimed === "string" && timingSafeEqual(digest(claimed), proxySecret);
}

function clientIpOf(headers: Record<string, unknown> | undefined): string | null {
  const ip = headers?.["x-storefront-client-ip"];
  return typeof ip === "string" && ip.length > 0 && ip.length <= 64 ? ip : null;
}
