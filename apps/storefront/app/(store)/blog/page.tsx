import type { BlogList } from "@devsfleet/storefront-client";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Breadcrumbs } from "@/components/store/listing";
import { EmptyState } from "@/components/ui/empty";
import { Pagination } from "@/components/ui/pagination";
import { cached, publicApi, tags } from "@/lib/api-server";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Guides",
  description: "Practical DIY and trade guides: cable sizes, tile quantities, plumbing fittings and more.",
  alternates: { canonical: "/blog" },
};

const PAGE_SIZE = 12;

export default async function BlogPage({ searchParams }: PageProps<"/blog">) {
  const raw = Number((await searchParams).page);
  const page = Number.isInteger(raw) && raw > 1 ? raw : 1;
  const data = await publicApi.get<BlogList>(`/content/blog?page=${page}`, cached([tags.content]));

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <Breadcrumbs items={[{ href: "/blog", label: "Guides" }]} />
      <h1 className="mt-3 text-4xl">Guides</h1>
      <p className="mt-1 max-w-[65ch] text-steel">DIY and trade guides to help you pick the right part and buy the right amount.</p>

      {data.items.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No guides yet">New guides are on the way. In the meantime, ask us anything on WhatsApp.</EmptyState>
        </div>
      ) : (
        <>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((post) => (
              <li key={post.slug}>
                <Link
                  href={`/blog/${post.slug}`}
                  className="group flex h-full flex-col overflow-hidden rounded-[var(--radius-panel)] border border-galv bg-paper hover:border-steel-light"
                >
                  {post.coverImageUrl && (
                    <div className="relative aspect-[16/9] bg-sheet">
                      <Image src={post.coverImageUrl} alt="" fill sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="object-cover" />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col p-5">
                    <h2 className="text-2xl group-hover:text-pipe">{post.title}</h2>
                    {post.excerpt && <p className="mt-2 flex-1 text-[15px] text-steel">{post.excerpt}</p>}
                    {post.publishedAt && (
                      <p className="mt-4 text-sm text-steel-light">
                        <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex justify-center">
            <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} href={(p) => (p > 1 ? `/blog?page=${p}` : "/blog")} />
          </div>
        </>
      )}
    </div>
  );
}
