import type { HomeSectionSettings } from "@devsfleet/shared-types";
import type { Branch, StoreInfo } from "@devsfleet/storefront-client";
import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import type { ReactNode } from "react";
import { SocialLinkList } from "@/components/store/social-links";
import { getBranches } from "@/lib/data";
import { WEEKDAYS, whatsappLink } from "@/lib/format";
import { clean, SecHeading, SectionFrame } from "./section-header";

function hoursOf(openingHours: unknown): Record<string, string> {
  if (!openingHours || typeof openingHours !== "object") return {};
  return Object.fromEntries(Object.entries(openingHours).filter((e): e is [string, string] => typeof e[1] === "string"));
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="sec-icon mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full">{icon}</span>
      <span className="min-w-0 pt-1.5 text-[15px]">{children}</span>
    </li>
  );
}

function BranchBlock({ branch, showHours }: { branch: Branch; showHours: boolean }) {
  const hours = hoursOf(branch.openingHours);
  const days = WEEKDAYS.filter((d) => hours[d.key]);
  return (
    <li className="sec-card p-5">
      <h3 className="font-cond text-xl font-semibold">{branch.name}</h3>
      {branch.address && <p className="sec-muted mt-1 text-[15px]">{branch.address}</p>}
      {branch.phone && (
        <p className="mt-1 text-[15px]">
          <a href={`tel:${branch.phone.replace(/\s/g, "")}`} className="sec-accent hover:underline">
            {branch.phone}
          </a>
        </p>
      )}
      {showHours && days.length > 0 && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
          {days.map((d) => (
            <div key={d.key} className="contents">
              <dt className="sec-muted">{d.label}</dt>
              <dd className="text-right tabular-nums">{hours[d.key]!.replace(/\s*-\s*/g, "–")}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

export async function ContactInfo({
  id,
  settings,
  store,
  align,
}: {
  id: string;
  settings: HomeSectionSettings["contact_info"];
  store: StoreInfo;
  align?: "left" | "center";
}) {
  const branches = settings.showBranches === false ? [] : await getBranches();
  const title = clean(settings.title);
  const heading = `contact-${id}`;
  const whatsapp = store.whatsapp ? whatsappLink(store.whatsapp) : null;
  const social = settings.showSocial === false ? null : <SocialLinkList social={store.theme.social} className="sec-fg" />;
  if (!store.address && !store.phone && !store.email && !whatsapp && branches.length === 0) return null;
  return (
    <SectionFrame>
      <section className="mt-14" aria-labelledby={title ? heading : undefined} aria-label={title ? undefined : "Contact details"}>
        <SecHeading id={heading} title={title} centered={align === "center"} />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div>
            <ul className="space-y-4">
              {store.address && (
                <Row icon={<MapPin className="size-5" aria-hidden />}>
                  <span className="sr-only">Address: </span>
                  {store.address}
                </Row>
              )}
              {store.phone && (
                <Row icon={<Phone className="size-5" aria-hidden />}>
                  <span className="sr-only">Phone: </span>
                  <a href={`tel:${store.phone.replace(/\s/g, "")}`} className="font-medium hover:underline">
                    {store.phone}
                  </a>
                </Row>
              )}
              {store.email && (
                <Row icon={<Mail className="size-5" aria-hidden />}>
                  <span className="sr-only">Email: </span>
                  <a href={`mailto:${store.email}`} className="font-medium hover:underline">
                    {store.email}
                  </a>
                </Row>
              )}
              {whatsapp && (
                <Row icon={<MessageCircle className="size-5" aria-hidden />}>
                  <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                    Message us on WhatsApp
                  </a>
                </Row>
              )}
            </ul>
            {social && <div className="mt-5">{social}</div>}
          </div>
          {branches.length > 0 && (
            <ul className="grid gap-4 sm:grid-cols-2">
              {branches.map((b) => (
                <BranchBlock key={b.id} branch={b} showHours={settings.showHours !== false} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </SectionFrame>
  );
}
