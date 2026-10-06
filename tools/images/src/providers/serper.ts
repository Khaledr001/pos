import { z } from "zod";
import { getJson, type HttpOptions } from "./http.js";
import { ProviderConfigError, type ImageHit, type ImageSearchProvider } from "./types.js";

export const SERPER_SETUP =
  "SERPER_API_KEY is not set. Sign up at https://serper.dev (the free credits need no card), copy the API key " +
  "from the dashboard, then add SERPER_API_KEY=<key> to .env. See tools/images/README.md.";

const ResultSchema = z.object({
  title: z.string().optional(),
  imageUrl: z.string().optional(),
  imageWidth: z.number().optional(),
  imageHeight: z.number().optional(),
  thumbnailUrl: z.string().optional(),
  link: z.string().optional(),
});
const ResponseSchema = z.object({ images: z.array(ResultSchema).default([]) });

/** serper.dev Google Images: `imageUrl` is the full image, `link` the page it sits on. */
export class SerperProvider implements ImageSearchProvider {
  readonly name = "serper";

  constructor(
    private readonly apiKey: string | undefined,
    private readonly http: HttpOptions = {},
  ) {
    if (!apiKey) throw new ProviderConfigError(SERPER_SETUP);
  }

  async search(query: string): Promise<ImageHit[]> {
    const body = ResponseSchema.parse(
      await getJson(
        "https://google.serper.dev/images",
        { "x-api-key": this.apiKey ?? "", "content-type": "application/json", accept: "application/json" },
        this.http,
        // gl biases results to the UAE, where the shop sells.
        { method: "POST", body: JSON.stringify({ q: query, gl: "ae", num: 10 }) },
      ),
    );
    return body.images.flatMap((r): ImageHit[] => {
      if (!r.imageUrl || !r.link) return [];
      return [
        {
          imageUrl: r.imageUrl,
          pageUrl: r.link,
          ...(r.thumbnailUrl ? { thumbnailUrl: r.thumbnailUrl } : {}),
          ...(r.title ? { title: r.title } : {}),
          ...(r.imageWidth ? { width: r.imageWidth } : {}),
          ...(r.imageHeight ? { height: r.imageHeight } : {}),
        },
      ];
    });
  }
}
