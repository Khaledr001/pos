import type { Metadata } from "next";
import { Suspense } from "react";
import { ContentView } from "@/components/admin/content/content";
import { Loading } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Pages and banners" };

export default function ContentPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ContentView />
    </Suspense>
  );
}
