import type { ReactNode } from "react";
import { AccountNav } from "./account-nav";

/** Side navigation around every account page. */
export function AccountShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
      <aside className="min-w-0">
        <AccountNav />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
