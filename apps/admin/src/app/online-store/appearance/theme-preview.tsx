import React from "react";
import type { StorefrontTheme } from "@devsfleet/shared-types";

const RADII = { sharp: ["2px", "4px"], soft: ["6px", "10px"], round: ["12px", "18px"] } as const;
const FONTS = {
  barlow: { body: "Barlow, ui-sans-serif, system-ui, sans-serif", head: "'Barlow Condensed', Barlow, ui-sans-serif, sans-serif" },
  inter: { body: "Inter, ui-sans-serif, system-ui, sans-serif", head: "Inter, ui-sans-serif, system-ui, sans-serif" },
  poppins: { body: "Poppins, ui-sans-serif, system-ui, sans-serif", head: "Poppins, ui-sans-serif, system-ui, sans-serif" },
  serif: { body: "Inter, ui-sans-serif, system-ui, sans-serif", head: "'Playfair Display', Georgia, serif" },
} as const;

/** Same derivation the storefront applies, so the mock and the shop agree. */
const mix = (color: string, other: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, ${other})`;

/**
 * A miniature shop drawn from the draft theme with CSS variables only. It
 * never touches the network, so every keystroke in the editor shows at once.
 */
export function ThemePreview({ theme, name }: { theme: StorefrontTheme; name: string }) {
  const { colors: c } = theme;
  const [rTag, rPanel] = RADII[theme.radius];
  const f = FONTS[theme.font];
  const vars = {
    "--p-ink": c.ink,
    "--p-accent": c.accent,
    "--p-accent-dark": mix(c.accent, "black", 80),
    "--p-accent-tint": mix(c.accent, "white", 12),
    "--p-highlight": c.highlight,
    "--p-bg": c.background,
    "--p-surface": c.surface,
    "--p-line": mix(c.ink, "transparent", 12),
    "--p-muted": mix(c.ink, c.surface, 62),
    fontFamily: f.body,
  } as React.CSSProperties;
  const heading = { fontFamily: f.head, fontWeight: 600 } as const;
  const button = (primary: boolean): React.CSSProperties => ({
    background: primary ? "var(--p-accent)" : "transparent",
    color: primary ? "#fff" : "var(--p-accent)",
    border: "1px solid var(--p-accent)",
    borderRadius: rTag,
    padding: "5px 12px",
    fontSize: 11,
    fontWeight: 600,
  });
  const logo = <span style={{ ...heading, fontSize: 16, color: "var(--p-ink)" }}>{name || "Your shop"}</span>;
  const search = (
    <div style={{ flex: 1, height: 26, border: "1px solid var(--p-line)", borderRadius: rTag, background: "var(--p-bg)", fontSize: 10, color: "var(--p-muted)", padding: "5px 8px" }}>Search products</div>
  );
  const dark = theme.layout.footer === "dark";

  return (
    <div aria-label="Preview of your shop" role="img" style={{ ...vars, background: "var(--p-bg)", color: "var(--p-ink)", border: "1px solid var(--p-line)", borderRadius: rPanel, overflow: "hidden", fontSize: 12 }}>
      {theme.announcement.enabled && theme.announcement.text && (
        <div style={{ background: "var(--p-ink)", color: "#fff", fontSize: 10, textAlign: "center", padding: "4px 8px" }}>{theme.announcement.text}</div>
      )}
      <div style={{ background: "var(--p-surface)", borderBottom: "1px solid var(--p-line)", padding: theme.layout.header === "compact" ? "6px 12px" : "10px 12px" }}>
        {theme.layout.header === "centered" ? (
          <div style={{ display: "grid", gap: 6, justifyItems: "center" }}>
            {logo}
            <div style={{ display: "flex", gap: 12, fontSize: 10, color: "var(--p-muted)" }}><span>Shop</span><span>Brands</span><span>Guides</span><span>Contact</span></div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {logo}
            {search}
            <span style={{ fontSize: 10, color: "var(--p-muted)" }}>Account · Cart</span>
          </div>
        )}
      </div>
      <div style={{ background: "var(--p-ink)", color: "#fff", padding: "18px 14px" }}>
        <div style={{ ...heading, fontSize: 18 }}>Everything for the job</div>
        <div style={{ fontSize: 10, opacity: 0.75, margin: "4px 0 10px" }}>Delivered to your door or ready for pickup.</div>
        <span style={{ ...button(true), background: "var(--p-highlight)", color: c.ink, borderColor: "var(--p-highlight)", display: "inline-block" }}>Shop now</span>
      </div>
      <div style={{ padding: 12 }}>
        <div style={{ ...heading, fontSize: 13, marginBottom: 8 }}>Best sellers</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                background: "var(--p-surface)",
                borderRadius: rPanel,
                border: theme.layout.productCard === "bordered" ? "1px solid var(--p-line)" : theme.layout.productCard === "standard" ? "1px solid transparent" : "none",
                boxShadow: theme.layout.productCard === "standard" ? "0 1px 3px rgb(0 0 0 / 0.12)" : "none",
                padding: theme.layout.productCard === "minimal" ? 0 : 8,
              }}
            >
              <div style={{ height: 44, background: "var(--p-accent-tint)", borderRadius: rTag }} />
              <div style={{ fontSize: 10, margin: "6px 0 2px" }}>Product {i + 1}</div>
              <div style={{ ...heading, fontSize: 13, color: "var(--p-accent)" }}>{(12.5 * (i + 1)).toFixed(2)}</div>
              <div style={{ fontSize: 9, display: "inline-block", padding: "1px 5px", borderRadius: rTag, background: "var(--p-accent-tint)", color: "var(--p-accent-dark)", marginTop: 3 }}>In stock</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <span style={button(true)}>Add to cart</span>
          <span style={button(false)}>Request a quote</span>
          <span style={{ fontSize: 9, alignSelf: "center", padding: "2px 6px", borderRadius: rTag, background: mix(c.highlight, "white", 18), color: c.ink }}>Trade price</span>
        </div>
      </div>
      <div style={{ background: dark ? "var(--p-ink)" : "var(--p-surface)", color: dark ? "rgb(255 255 255 / 0.8)" : "var(--p-muted)", borderTop: "1px solid var(--p-line)", padding: "10px 12px", fontSize: 10, display: "flex", justifyContent: "space-between" }}>
        <span>© {name || "Your shop"}</span>
        <span>Privacy · Terms</span>
      </div>
    </div>
  );
}
