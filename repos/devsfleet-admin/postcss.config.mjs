/**
 * Tailwind v4 ships as a PostCSS plugin; there is no tailwind.config.js.
 * Design tokens live in src/app/globals.css under `@theme`.
 */
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
