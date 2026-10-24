/**
 * Rules for a shop address on the platform's own domain — `allahiq.devsfleet.com`.
 *
 * Every tenant's store is served by one storefront app, picked by hostname, and
 * the platform's own sites (the admin panel, the API, the CDN) live on the same
 * domain. Without these rules a tenant could claim `pos.devsfleet.com` or
 * `pos-api.devsfleet.com` as a storefront domain, or squat on another shop's
 * obvious name before it signs up. Hostnames on any OTHER domain are a tenant's
 * own custom domain and are not restricted here.
 */

/**
 * Labels no tenant may take. The platform's live hostnames (pos, pos-api, cdn,
 * api) are in it, plus the names any service might plausibly need later and
 * the ones a shopper would read as official. Add to it before putting a new
 * platform site on the domain — never after a tenant could have claimed it.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  // The platform's own hosts.
  "pos",
  "pos-api",
  "api",
  "cdn",
  "admin",
  "app",
  // DevsFleet's ISP product, served from the same VPS.
  "isp",
  "isp-api",
  // Reads as official to a shopper.
  "www",
  "devsfleet",
  "platform",
  "billing",
  "auth",
  "login",
  "account",
  "accounts",
  "secure",
  "help",
  "support",
  "status",
  "docs",
  "blog",
  // Infrastructure and mail.
  "mail",
  "webmail",
  "smtp",
  "imap",
  "pop",
  "mx",
  "ftp",
  "ns1",
  "ns2",
  "static",
  "assets",
  "media",
  "files",
  "uploads",
  // Environments.
  "dev",
  "staging",
  "test",
  "demo",
  "beta",
]);

const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Why a label cannot be a shop address, in words for the shop owner — or null when it can. */
export function subdomainLabelProblem(label: string): string | null {
  if (label.length < 3) return "Use at least 3 characters.";
  if (label.length > 40) return "Use at most 40 characters.";
  if (!LABEL.test(label)) {
    return "Use only lowercase letters, numbers and hyphens, without a hyphen at the start or end.";
  }
  if (RESERVED_SUBDOMAINS.has(label)) return "That address is reserved. Try another name.";
  return null;
}

export type HostnameCheck = { ok: true } | { ok: false; message: string };

/**
 * Whether `hostname` may be a storefront domain, given the platform's base
 * domain. With no base domain configured every hostname passes — there is no
 * platform domain to protect.
 */
export function checkStorefrontHostname(hostname: string, baseDomain: string | null | undefined): HostnameCheck {
  const base = baseDomain?.trim().toLowerCase();
  if (!base) return { ok: true };
  const host = hostname.trim().toLowerCase();

  if (host === base) {
    return { ok: false, message: `${base} itself can't be a shop address. Choose a name like yourshop.${base}.` };
  }
  const suffix = `.${base}`;
  if (!host.endsWith(suffix)) return { ok: true };

  const label = host.slice(0, -suffix.length);
  if (label.includes(".")) {
    return { ok: false, message: `Use a single name before .${base}, like yourshop.${base}.` };
  }
  const problem = subdomainLabelProblem(label);
  return problem ? { ok: false, message: problem } : { ok: true };
}

/**
 * A starting suggestion from the business name: "AL Lahiq Elect. & Sanitary"
 * → "al-lahiq-elect-sanitary", trimmed to the length limit on a word boundary.
 */
export function suggestSubdomainLabel(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= 40) return slug;
  const cut = slug.slice(0, 40);
  const lastHyphen = cut.lastIndexOf("-");
  return (lastHyphen >= 3 ? cut.slice(0, lastHyphen) : cut).replace(/-+$/, "");
}
