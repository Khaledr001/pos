"use client";

import Link from "next/link";
import Script from "next/script";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { CONSENT_KEY } from "@/lib/analytics";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

type Consent = "granted" | "denied" | null;

// Consent lives in localStorage; this store lets components react to changes.
const listeners = new Set<() => void>();
function readConsent(): Consent {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}
function writeConsent(v: Exclude<Consent, null>) {
  try {
    localStorage.setItem(CONSENT_KEY, v);
  } catch {
    // storage blocked: the choice lasts for this page view only
  }
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Analytics scripts (after consent) and the cookie banner. Renders nothing if no IDs are set. */
export function Analytics() {
  const consent = useSyncExternalStore(subscribe, readConsent, () => "denied" as Consent);
  if (!GA_ID && !PIXEL_ID) return null;

  return (
    <>
      {consent === "granted" && GA_ID && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
          <Script id="ga4" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config','${GA_ID}');`}
          </Script>
        </>
      )}
      {consent === "granted" && PIXEL_ID && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${PIXEL_ID}');fbq('track','PageView');`}
        </Script>
      )}
      {consent === null && (
        <div role="dialog" aria-label="Cookie choices" className="fixed inset-x-3 bottom-20 z-50 mx-auto max-w-xl rounded-[var(--radius-panel)] border border-galv bg-paper p-4 shadow-lg sm:bottom-4">
          <p className="text-[15px]">
            We use cookies to keep you logged in and your cart saved. With your permission we also use analytics cookies to see which
            products people look for. <Link href="/pages/privacy" className="underline">Privacy policy</Link>
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => writeConsent("granted")}>
              Allow analytics
            </Button>
            <Button size="sm" variant="secondary" onClick={() => writeConsent("denied")}>
              Essential only
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
