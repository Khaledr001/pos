import { z } from "zod";
import { getJson, type HttpOptions } from "./http.js";
import { ProviderConfigError, type ImageHit, type ImageSearchProvider } from "./types.js";

export const SERPAPI_SETUP =
  "SERPAPI_KEY is not set. Create an account at https://serpapi.com, copy the API key from the dashboard, " +
  "then export SERPAPI_KEY=<key>. See tools/images/README.md.";

const ResultSchema = z.object({
  title: z.string().optional(),
  link: z.string().optional(),
  original: z.string().optional(),
  thumbnail: z.string().optional(),
  original_width: z.number().optional(),
  original_height: z.number().optional(),
});
const ResponseSchema = z.object({ images_results: z.array(ResultSchema).default([]) });

/** SerpAPI `engine=google_images`: `original` is the full image, `link` the source page. */
export class SerpApiProvider implements ImageSearchProvider {
  readonly name = "serpapi";

  constructor(
    private readonly apiKey: string | undefined,
    private readonly http: HttpOptions = {},
  ) {
    if (!apiKey) throw new ProviderConfigError(SERPAPI_SETUP);
  }

  async search(query: string): Promise<ImageHit[]> {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_images");
    url.searchParams.set("q", query);
    url.searchParams.set("safe", "active");
    url.searchParams.set("api_key", this.apiKey ?? "");
    const body = ResponseSchema.parse(await getJson(url.toString(), { accept: "application/json" }, this.http));
    return body.images_results.flatMap((r): ImageHit[] => {
      if (!r.original || !r.link) return [];
      return [
        {
          imageUrl: r.original,
          pageUrl: r.link,
          ...(r.thumbnail ? { thumbnailUrl: r.thumbnail } : {}),
          ...(r.title ? { title: r.title } : {}),
          ...(r.original_width ? { width: r.original_width } : {}),
          ...(r.original_height ? { height: r.original_height } : {}),
        },
      ];
    });
  }
}
