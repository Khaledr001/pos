import { z } from "zod";
import { getJson, type HttpOptions } from "./http.js";
import { ProviderConfigError, type ImageHit, type ImageSearchProvider } from "./types.js";

export const BRAVE_SETUP =
  "BRAVE_SEARCH_API_KEY is not set. Create a free key at https://api-dashboard.search.brave.com " +
  "(subscribe to the Search plan, then create an API key), then export BRAVE_SEARCH_API_KEY=<key>. " +
  "See tools/images/README.md.";

const ResultSchema = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  thumbnail: z.object({ src: z.string().optional() }).partial().optional(),
  properties: z
    .object({ url: z.string().optional(), width: z.number().optional(), height: z.number().optional() })
    .partial()
    .optional(),
});
const ResponseSchema = z.object({ results: z.array(ResultSchema).default([]) });

/**
 * Brave Search API — images endpoint.
 * GET https://api.search.brave.com/res/v1/images/search, auth via the
 * `X-Subscription-Token` header; `count` max 200, `safesearch` strict by
 * default. Each result has the source page in `url`, the original image in
 * `properties.url` and its size in `properties.width/height`.
 */
export class BraveProvider implements ImageSearchProvider {
  readonly name = "brave";

  constructor(
    private readonly apiKey: string | undefined,
    private readonly http: HttpOptions = {},
    private readonly count = 20,
  ) {
    if (!apiKey) throw new ProviderConfigError(BRAVE_SETUP);
  }

  async search(query: string): Promise<ImageHit[]> {
    const url = new URL("https://api.search.brave.com/res/v1/images/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(this.count));
    url.searchParams.set("safesearch", "strict");
    url.searchParams.set("spellcheck", "false");
    const body = ResponseSchema.parse(
      await getJson(url.toString(), { accept: "application/json", "x-subscription-token": this.apiKey ?? "" }, this.http),
    );
    return body.results.flatMap((r): ImageHit[] => {
      const imageUrl = r.properties?.url;
      if (!imageUrl || !r.url) return [];
      return [
        {
          imageUrl,
          pageUrl: r.url,
          ...(r.thumbnail?.src ? { thumbnailUrl: r.thumbnail.src } : {}),
          ...(r.title ? { title: r.title } : {}),
          ...(r.properties?.width ? { width: r.properties.width } : {}),
          ...(r.properties?.height ? { height: r.properties.height } : {}),
        },
      ];
    });
  }
}
