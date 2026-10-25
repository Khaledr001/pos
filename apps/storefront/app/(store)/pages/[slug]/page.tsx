import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { Breadcrumbs } from "@/components/store/listing";
import { Markdown } from "@/components/store/markdown";
import { PageSections } from "@/components/store/sections/page-sections";
import { getPage } from "@/lib/content";
import { getStore, getFormat } from "@/lib/data";

import { socialMeta } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/pages/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const [page, store] = await Promise.all([getPage(slug), getStore()]);
  const title = page.seoTitle ?? page.title;
  const description = page.seoDescription ?? page.excerpt;
  return {
    title,
    description: description ?? undefined,
    ...socialMeta({ title, description, path: page.kind === "blog" ? `/blog/${slug}` : `/pages/${slug}`, image: page.coverImageUrl, siteName: store.name }),
  };
}

export default async function ContentPage({ params }: PageProps<"/pages/[slug]">) {
  const { slug } = await params;
  const [page, store] = await Promise.all([getPage(slug), getStore()]);
  if (page.kind === "blog") permanentRedirect(`/blog/${slug}`);

  // A page built from sections: the shop decides what is on it.
  if (page.sections) {
    const sections = page.sections.filter((s) => s.enabled);
    // The first hero carries the page's <h1>; without one the page still needs a heading.
    const hasHero = sections.some((s) => s.type === "hero");

    if (page.layout === "full") {
      return (
        <>
          {!hasHero && <h1 className="sr-only">{page.title}</h1>}
          <PageSections sections={sections} store={store} />
        </>
      );
    }
    return (
      <>
        <div className="mx-auto max-w-7xl px-4 pt-6">
          <Breadcrumbs items={[{ href: `/pages/${slug}`, label: page.title }]} />
          {!hasHero && <h1 className="mt-3 text-4xl">{page.title}</h1>}
        </div>
        <PageSections sections={sections} store={store} />
      </>
    );
  }

  const f = await getFormat();
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Breadcrumbs items={[{ href: `/pages/${slug}`, label: page.title }]} />
      <article className="mt-3">
        <h1 className="text-4xl">{page.title}</h1>
        <p className="mt-1 text-sm text-steel">Last updated {f.date(page.updatedAt)}</p>
        <div className="mt-6 rounded-[var(--radius-panel)] border border-galv bg-paper p-5 sm:p-8">
          <Markdown>{page.body}</Markdown>
        </div>
      </article>
    </div>
  );
}
