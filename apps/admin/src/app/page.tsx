import { DEFAULT_TENANT_SETTINGS } from "@devsfleet/shared-types";
import { Money, calculateDocument } from "@devsfleet/shared-utils";

/**
 * Scaffold landing page.
 *
 * It deliberately calls into the shared packages rather than being static
 * markup: if `pnpm --filter @devsfleet/admin build` succeeds, the workspace
 * wiring, the Tailwind v4 pipeline and cross-package type resolution are all
 * proven at once. Replaced by the real dashboard in Phase 6.
 */
export default function Home() {
  const example = calculateDocument({
    taxMode: DEFAULT_TENANT_SETTINGS.tax.mode,
    lines: [
      { quantity: 50, unitPrice: "2.20", taxPercent: DEFAULT_TENANT_SETTINGS.tax.defaultRate },
      { quantity: 2, unitPrice: "15.00", taxPercent: DEFAULT_TENANT_SETTINGS.tax.defaultRate },
    ],
  });

  const rows = [
    ["Subtotal", example.subtotal],
    [`${DEFAULT_TENANT_SETTINGS.tax.label} ${DEFAULT_TENANT_SETTINGS.tax.defaultRate}%`, example.taxAmount],
    ["Total", example.total],
  ] as const;

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-2">
        <p className="text-sm font-medium text-brand">DevsFleet Business Platform</p>
        <h1 className="text-3xl font-semibold tracking-tight">Admin panel</h1>
        <p className="text-[--color-muted]">
          Scaffold is running. The dashboard, product management and reporting
          screens land in Phase 6.
        </p>
      </header>

      <section
        className="rounded-[--radius-card] border border-[--color-border] bg-[--color-surface] p-5"
        aria-label="Shared pricing engine check"
      >
        <h2 className="mb-3 text-sm font-medium text-[--color-muted]">
          Shared totals engine
        </h2>
        <dl className="tabular space-y-1.5 text-sm">
          {rows.map(([label, amount]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className={label === "Total" ? "font-medium" : "text-[--color-muted]"}>
                {label}
              </dt>
              <dd className={label === "Total" ? "font-semibold" : ""}>
                {Money.formatMoney(amount, {
                  currency: DEFAULT_TENANT_SETTINGS.currency.base,
                })}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-[--color-muted]">
          Computed by <code className="font-mono">calculateDocument</code> from{" "}
          <code className="font-mono">@devsfleet/shared-utils</code> — the same
          function the API and the POS terminal use.
        </p>
      </section>
    </main>
  );
}
