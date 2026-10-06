/**
 * Structured data for crawlers. `<` is escaped so a product name or CMS
 * field containing "</script>" cannot close the tag and inject markup.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
