import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";

/**
 * Serves POS terminal installers straight out of the admin app — no nginx
 * static-file location required.
 *
 * This exists because a separate `location /pos-dl/` block in nginx needs a
 * manual, one-time sync onto every VPS this ever runs on, completely
 * unrelated to anything this app deploys — and on the VPS this was first
 * wired up on, touching nginx at all surfaced a pre-existing broken
 * `options-ssl-nginx.conf` reference that took the config down. Routing
 * through the app we already deploy (behind the SAME unmodified `location /`
 * proxy every other admin page uses) means publishing or reinstalling a
 * release never touches nginx again.
 *
 * `deploy/release-pos.sh` and .github/workflows/pos-release.yml still write
 * to the same on-disk directory — only how it's SERVED changed, not where
 * releases land.
 */
const RELEASES_DIR = process.env.POS_RELEASES_DIR ?? "/var/www/devsfleet-pos-releases";

function contentTypeFor(name: string): string {
  if (name.endsWith(".yml") || name.endsWith(".yaml")) return "text/yaml; charset=utf-8";
  if (name.endsWith(".exe")) return "application/vnd.microsoft.portable-executable";
  if (name.endsWith(".dmg")) return "application/x-apple-diskimage";
  if (name.endsWith(".deb")) return "application/vnd.debian.binary-package";
  if (name.endsWith(".AppImage")) return "application/x-executable";
  if (name.endsWith(".blockmap")) return "application/octet-stream";
  return "application/octet-stream";
}

/**
 * Resolves the request to a real file inside RELEASES_DIR, or null.
 *
 * Exactly one flat segment: nothing this feed ever writes needs a
 * subdirectory, and a bare filename with no `/`, `\`, or `..` cannot resolve
 * outside RELEASES_DIR regardless of what a client sends — the
 * normalize+prefix check below is a second, independent guard against that
 * same class of mistake, not a replacement for this one.
 */
function resolveFile(segments: string[]): { path: string; name: string; size: number } | null {
  if (segments.length !== 1) return null;
  const name = segments[0]!;
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return null;

  // RELEASES_DIR lives entirely outside this project (a shared VPS
  // directory, not app source) — there is nothing under it for Next's
  // build-time file tracer to usefully find, and without this hint it falls
  // back to tracing (and bundling into the standalone output) far more of
  // the project than this route actually needs.
  const filePath = join(/* turbopackIgnore: true */ RELEASES_DIR, name);
  if (!normalize(filePath).startsWith(normalize(RELEASES_DIR))) return null;
  if (!existsSync(filePath)) return null;

  const stat = statSync(filePath);
  if (!stat.isFile()) return null;
  return { path: filePath, name, size: stat.size };
}

async function handle(
  { params }: { params: Promise<{ path: string[] }> },
  includeBody: boolean,
): Promise<Response> {
  const { path: segments } = await params;
  const file = resolveFile(segments);
  if (!file) return new Response("Not found", { status: 404 });

  const headers = {
    "Content-Type": contentTypeFor(file.name),
    "Content-Length": String(file.size),
    "Content-Disposition": `attachment; filename="${file.name}"`,
    // latest*.yml is overwritten on every release and must be revalidated on
    // every poll, or a till (or this app's own Releases page) stuck behind a
    // cache would never see a new version exists. Installers change name
    // every release too (the version is in the filename), so there is no
    // upside to caching those either.
    "Cache-Control": "no-cache",
  };

  if (!includeBody) return new Response(null, { headers });

  const webStream = Readable.toWeb(createReadStream(file.path)) as ReadableStream;
  return new Response(webStream, { headers });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return handle(context, true);
}

export async function HEAD(
  _request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return handle(context, false);
}
