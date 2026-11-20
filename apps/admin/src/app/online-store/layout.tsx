import type { ReactNode } from "react";
import { WebsiteTabs } from "./store-nav";

export default function OnlineStoreLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <WebsiteTabs />
      {children}
    </div>
  );
}
