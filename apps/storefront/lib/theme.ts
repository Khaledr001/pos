import { DEFAULT_THEME, HEX_COLOR, type FontPairId, type RadiusStyle, type StorefrontTheme } from "@devsfleet/shared-types";

/** Corner radii per style. "sharp" is the look the shop launched with. */
const RADII: Record<RadiusStyle, { tag: string; panel: string }> = {
  sharp: { tag: "4px", panel: "10px" },
  soft: { tag: "8px", panel: "14px" },
  round: { tag: "12px", panel: "22px" },
};

/** Which loaded font backs body text and headings for each pair. */
const FONT_STACKS: Record<FontPairId, { sans: string; cond: string }> = {
  barlow: { sans: "var(--font-barlow)", cond: "var(--font-barlow-condensed), var(--font-barlow)" },
  inter: { sans: "var(--font-inter)", cond: "var(--font-inter)" },
  poppins: { sans: "var(--font-poppins)", cond: "var(--font-poppins)" },
  serif: { sans: "var(--font-inter)", cond: "var(--font-playfair)" },
};

/** The next/font variable names each pair needs on <html>. */
export const FONT_VARIABLES: Record<FontPairId, string[]> = {
  barlow: ["--font-barlow", "--font-barlow-condensed"],
  inter: ["--font-inter"],
  poppins: ["--font-poppins"],
  serif: ["--font-inter", "--font-playfair"],
};

const hex = (value: string, fallback: string) => (HEX_COLOR.test(value) ? value.toLowerCase() : fallback);

/**
 * The :root overrides for one shop's theme.
 *
 * Only validated tokens reach the string: colours must be six-digit hex (else
 * the default is used) and every other value comes from a closed table above,
 * so tenant-supplied text can never close the <style> tag or add a rule.
 * Tints and hover shades are derived with color-mix from the five base colours.
 */
export function themeCss(theme: StorefrontTheme): string {
  const d = DEFAULT_THEME.colors;
  const c = {
    ink: hex(theme.colors.ink, d.ink),
    accent: hex(theme.colors.accent, d.accent),
    highlight: hex(theme.colors.highlight, d.highlight),
    background: hex(theme.colors.background, d.background),
    surface: hex(theme.colors.surface, d.surface),
  };
  const radius = RADII[theme.radius] ?? RADII.sharp;
  const font = FONT_STACKS[theme.font] ?? FONT_STACKS.barlow;
  return [
    ":root{",
    `--color-ink:${c.ink};`,
    `--color-pipe:${c.accent};`,
    `--color-brass:${c.highlight};`,
    `--color-sheet:${c.background};`,
    `--color-paper:${c.surface};`,
    "--color-pipe-dark:color-mix(in srgb,var(--color-pipe) 76%,black);",
    "--color-pipe-tint:color-mix(in srgb,var(--color-pipe) 10%,white);",
    "--color-brass-tint:color-mix(in srgb,var(--color-brass) 13%,white);",
    "--color-brass-ink:color-mix(in srgb,var(--color-brass) 55%,black);",
    "--color-steel:color-mix(in srgb,var(--color-ink) 71%,white);",
    "--color-steel-light:color-mix(in srgb,var(--color-ink) 52%,white);",
    "--color-galv:color-mix(in srgb,var(--color-ink) 12%,white);",
    `--font-sans:${font.sans},ui-sans-serif,system-ui,sans-serif;`,
    `--font-cond:${font.cond},ui-sans-serif,sans-serif;`,
    `--radius-tag:${radius.tag};`,
    `--radius-panel:${radius.panel};`,
    "}",
  ].join("");
}

/** The browser-chrome colour: the header ink, or the default if it is not a valid hex. */
export function themeColor(theme: StorefrontTheme): string {
  return hex(theme.colors.ink, DEFAULT_THEME.colors.ink);
}
