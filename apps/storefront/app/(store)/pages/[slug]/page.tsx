import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { Breadcrumbs } from "@/components/store/listing";
import { Markdown } from "@/components/store/markdown";
import { getPage } from "@/lib/content";
import { formatDate } from "@/lib/format";

export async function generateMetadata({ params }: PageProps<"/pages/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPage(slug);
  return {
    title: page.seoTitle ?? page.title,
    description: page.seoDescription ?? page.excerpt ?? undefined,
    alternates: { canonical: page.kind === "blog" ? `/blog/${slug}` : `/pages/${slug}` },
  };
}

export default async function ContentPage({ params }: PageProps<"/pages/[slug]">) {
  const { slug } = await params;
  const page = await getPage(slug);
  if (page.kind === "blog") permanentRedirect(`/blog/${slug}`);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Breadcrumbs items={[{ href: `/pages/${slug}`, label: page.title }]} />
      <article className="mt-3">
        <h1 className="text-4xl">{page.title}</h1>
        <p className="mt-1 text-sm text-steel">Last updated {formatDate(page.updatedAt)}</p>
        <div className="mt-6 rounded-[var(--radius-panel)] border border-galv bg-paper p-5 sm:p-8">
          <Markdown>{page.body}</Markdown>
        </div>
      </article>
    </div>
  );
}
