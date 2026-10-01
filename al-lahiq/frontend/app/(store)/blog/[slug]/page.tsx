import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { Breadcrumbs } from "@/components/store/listing";
import { Markdown } from "@/components/store/markdown";
import { getPage } from "@/lib/content";
import { formatDate } from "@/lib/format";

export async function generateMetadata({ params }: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPage(slug);
  return {
    title: page.seoTitle ?? page.title,
    description: page.seoDescription ?? page.excerpt ?? undefined,
    alternates: { canonical: `/blog/${slug}` },
    openGraph: { type: "article", title: page.title, images: page.coverImageUrl ? [page.coverImageUrl] : undefined },
  };
}

export default async function GuidePage({ params }: PageProps<"/blog/[slug]">) {
  const { slug } = await params;
  const page = await getPage(slug);
  if (page.kind !== "blog") permanentRedirect(`/pages/${slug}`);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Breadcrumbs items={[{ href: "/blog", label: "Guides" }, { href: `/blog/${slug}`, label: page.title }]} />
      <article className="mt-3">
        <h1 className="text-4xl">{page.title}</h1>
        {page.publishedAt && (
          <p className="mt-1 text-sm text-steel">
            <time dateTime={page.publishedAt}>{formatDate(page.publishedAt)}</time>
          </p>
        )}
        {page.excerpt && <p className="mt-3 text-lg text-steel">{page.excerpt}</p>}
        {page.coverImageUrl && (
          <div className="relative mt-6 aspect-[16/9] overflow-hidden rounded-[var(--radius-panel)] border border-galv bg-paper">
            <Image src={page.coverImageUrl} alt="" fill sizes="(min-width: 768px) 768px, 100vw" className="object-cover" priority />
          </div>
        )}
        <div className="mt-6 rounded-[var(--radius-panel)] border border-galv bg-paper p-5 sm:p-8">
          <Markdown>{page.body}</Markdown>
        </div>
      </article>
      <aside className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-galv bg-paper p-5">
        <p className="text-[15px]">Not sure what you need? Send us a photo of the part on WhatsApp and we&apos;ll help you choose.</p>
        <Link href="/contact" className="font-semibold text-pipe hover:underline">
          Contact us
        </Link>
      </aside>
      <p className="mt-6">
        <Link href="/blog" className="text-sm font-semibold text-pipe hover:underline">
          More guides
        </Link>
      </p>
    </div>
  );
}
