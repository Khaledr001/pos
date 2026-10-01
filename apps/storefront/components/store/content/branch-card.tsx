import type { Branch } from "@devsfleet/storefront-client";
import { MapPin, Navigation, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { emirateName, WEEKDAYS } from "@/lib/format";

function hours(openingHours: unknown): Record<string, string> {
  if (!openingHours || typeof openingHours !== "object") return {};
  return Object.fromEntries(Object.entries(openingHours).filter((e): e is [string, string] => typeof e[1] === "string"));
}

/** "07:30-12:00, 14:00-20:00" → "07:30–12:00, 14:00–20:00" */
const pretty = (h: string) => h.replace(/\s*-\s*/g, "–");

export function BranchCard({ branch }: { branch: Branch }) {
  const h = hours(branch.openingHours);
  const directions =
    branch.lat != null && branch.lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${branch.lat},${branch.lng}` : null;
  return (
    <li className="flex flex-col rounded-[var(--radius-panel)] border border-galv bg-paper p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-2xl">{branch.name}</h2>
        {branch.pickupEnabled && <Badge tone="pipe">Store pickup</Badge>}
      </div>
      <p className="text-sm text-steel">{emirateName(branch.emirate)}</p>
      <p className="mt-3 flex gap-2 text-[15px]">
        <MapPin className="mt-0.5 size-4 shrink-0 text-steel" aria-hidden />
        {branch.address}
      </p>
      {branch.phone && (
        <p className="mt-1 flex gap-2 text-[15px]">
          <Phone className="mt-0.5 size-4 shrink-0 text-steel" aria-hidden />
          <a href={`tel:${branch.phone.replace(/\s/g, "")}`} className="text-pipe hover:underline">
            {branch.phone}
          </a>
        </p>
      )}
      {Object.keys(h).length > 0 && (
        <table className="mt-4 w-full text-[15px]">
          <caption className="mb-1 text-left text-sm font-medium text-steel">Opening hours</caption>
          <tbody>
            {WEEKDAYS.map((d) => (
              <tr key={d.key} className="border-t border-galv first:border-t-0">
                <th scope="row" className="py-1.5 pr-4 text-left font-normal">
                  {d.label}
                </th>
                <td className="py-1.5 text-right tabular-nums">{h[d.key] ? pretty(h[d.key]) : <span className="text-steel">Closed</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {directions && (
        <div className="mt-auto pt-4">
          <a href={directions} target="_blank" rel="noopener" className={buttonClass("secondary", "md", "w-full")}>
            <Navigation className="size-4" aria-hidden /> Get directions
            <span className="sr-only"> to {branch.name} (opens Google Maps)</span>
          </a>
        </div>
      )}
    </li>
  );
}
