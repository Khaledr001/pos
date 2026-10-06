import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImageHit, ImageSearchProvider } from "./types.js";

/**
 * Remembers every provider response on disk, keyed by provider + query, so a
 * re-run (after a crash, or with a tweaked scorer) costs no API calls. Entries
 * never expire on their own: search results for a hardware part are stable
 * enough, and deleting the directory is the explicit refresh.
 */
export class CachedProvider implements ImageSearchProvider {
  readonly name: string;
  /** Live (non-cached) calls made — what the quota is charged for. */
  liveCalls = 0;

  constructor(
    private readonly inner: ImageSearchProvider,
    private readonly dir: string,
  ) {
    this.name = inner.name;
  }

  async search(query: string): Promise<ImageHit[]> {
    const file = join(this.dir, `${createHash("sha256").update(`${this.inner.name}\n${query}`).digest("hex")}.json`);
    try {
      return JSON.parse(await readFile(file, "utf8")) as ImageHit[];
    } catch {
      // miss
    }
    const hits = await this.inner.search(query);
    this.liveCalls += 1;
    await mkdir(this.dir, { recursive: true });
    await writeFile(file, JSON.stringify(hits));
    return hits;
  }
}
