import { BadgePercent, FileText, UserCheck } from "lucide-react";
import { TradeStatusPanel } from "./trade-form";

const BENEFITS = [
  {
    icon: BadgePercent,
    title: "Project pricing and quantity breaks",
    text: "Your own prices on the items you buy most, and lower unit prices when you buy in bulk.",
  },
  {
    icon: FileText,
    title: "Tax invoices with your TRN",
    text: "Every order comes with a VAT invoice in your company name, ready for your accounts.",
  },
  {
    icon: UserCheck,
    title: "Prices set by our team",
    text: "Once we approve your account, our sales team sets your trade prices. You see them across the store whenever you're logged in.",
  },
];

/** Trade account explainer plus the visitor's own status or application form. */
export function TradeContent({ standalone }: { standalone?: boolean }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl">{standalone ? "Trade accounts" : "Trade account"}</h1>
        <p className="mt-1 max-w-[65ch] text-steel">
          For contractors, maintenance companies and fit-out teams who buy from us regularly.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-3">
        {BENEFITS.map((b) => (
          <li key={b.title} className="rounded-[var(--radius-panel)] border border-galv bg-paper p-4">
            <b.icon className="size-6 text-pipe" aria-hidden />
            <h2 className="mt-2 text-xl">{b.title}</h2>
            <p className="mt-1 text-[15px] text-steel">{b.text}</p>
          </li>
        ))}
      </ul>

      <TradeStatusPanel />
    </div>
  );
}
