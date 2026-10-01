import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Called by the backend (RevalidationService) when the POS or an admin changes
 * data. Prices and stock expire immediately so the next visitor sees them;
 * editorial content refreshes in the background.
 */
export async function POST(request: NextRequest) {
  if (request.headers.get("x-revalidate-secret") !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { tags?: unknown } | null;
  const list = Array.isArray(body?.tags) ? body.tags.filter((t): t is string => typeof t === "string") : [];

  for (const tag of list.slice(0, 500)) {
    const urgent = tag === "catalog" || tag === "home" || tag.startsWith("sku:") || tag.startsWith("product:");
    revalidateTag(tag, urgent ? { expire: 0 } : "max");
  }
  return NextResponse.json({ revalidated: list.length });
}
