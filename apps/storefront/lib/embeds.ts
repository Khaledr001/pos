/**
 * Embeds a page section may show. A tenant pastes a normal address; only
 * these providers, through their own embed endpoints, ever reach an <iframe>.
 * Anything else yields null and the section renders nothing.
 */

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com", "youtu.be"]);

function parse(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** A YouTube or Vimeo watch/embed address → the provider's privacy-friendly embed address. */
export function videoEmbedSrc(url: string | undefined): string | null {
  const u = parse(url);
  if (!u) return null;
  const host = u.hostname.toLowerCase();

  if (YOUTUBE_HOSTS.has(host)) {
    const parts = u.pathname.split("/").filter(Boolean);
    const id =
      host === "youtu.be"
        ? parts[0]
        : u.pathname === "/watch"
          ? u.searchParams.get("v")
          : parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live"
            ? parts[1]
            : null;
    return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }

  if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") {
    const id = u.pathname.split("/").filter(Boolean).find((part) => /^\d{6,12}$/.test(part));
    // dnt=1 asks Vimeo not to set tracking cookies.
    return id ? `https://player.vimeo.com/video/${id}?dnt=1` : null;
  }
  return null;
}

const MAP_EMBEDS: { host: string; path: string }[] = [
  { host: "www.google.com", path: "/maps/embed" },
  { host: "maps.google.com", path: "/maps" },
  { host: "www.openstreetmap.org", path: "/export/embed.html" },
];

/** A Google Maps or OpenStreetMap EMBED address, re-serialised; any other address is refused. */
export function mapEmbedSrc(url: string | undefined): string | null {
  const u = parse(url);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  const allowed = MAP_EMBEDS.some((m) => m.host === host && u.pathname.startsWith(m.path));
  return allowed ? u.href : null;
}

/** A "show me on a map" link for a branch: coordinates when it has them, its address otherwise. */
export function mapsLink(branch: { lat: number | null; lng: number | null; address: string; name: string }): string {
  const query = branch.lat != null && branch.lng != null ? `${branch.lat},${branch.lng}` : `${branch.name}, ${branch.address}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
