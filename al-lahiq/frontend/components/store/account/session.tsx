"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FormError } from "@/components/ui/field";
import { ApiError, errorMessage } from "@/lib/api-browser";

/** errorMessage(), plus plain words for the API's rate limit. */
export function friendlyError(err: unknown) {
  if (err instanceof ApiError && err.status === 429) return "We're getting a lot of requests from you right now. Wait a minute, then try again.";
  return errorMessage(err);
}

/** Error text for a failed account query; an ended session gets a login link back to this page. */
export function QueryError({ error }: { error: unknown }) {
  const pathname = usePathname();
  if (error instanceof ApiError && error.status === 401) {
    return (
      <div role="alert" className="rounded-[var(--radius-tag)] border border-brass/40 bg-brass-tint px-3 py-2 text-sm text-[#7a5a0c]">
        You&apos;ve been logged out.{" "}
        <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="font-semibold underline">
          Log in again
        </Link>{" "}
        to see this page.
      </div>
    );
  }
  return <FormError message={friendlyError(error)} />;
}
