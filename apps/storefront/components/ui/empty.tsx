import type { ReactNode } from "react";

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-dashed border-galv bg-paper px-6 py-12 text-center">
      <h2 className="text-2xl">{title}</h2>
      {children && <div className="mx-auto mt-2 max-w-md text-steel">{children}</div>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
