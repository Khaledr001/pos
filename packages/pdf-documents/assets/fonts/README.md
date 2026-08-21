# Bundled fonts

`NotoSansArabic-Regular.ttf`, `NotoSansArabic-SemiBold.ttf` — Google Noto,
licensed under the SIL Open Font License 1.1 (https://openfontlicense.org).

Bundled rather than resolved from the host because neither consumer of this
package has system fonts available: the API runs in a container, and the POS
main process is an Electron install on a till. Without these, the Arabic
labels on a tax invoice render as tofu boxes. Latin text uses PDF's built-in
Helvetica, which needs no embedding — these two files exist only for the
Arabic.

Live here rather than in either app because this directory ships alongside
`dist` in every consumer: `"files": ["dist", "assets"]` in this package's
`package.json` is what `pnpm deploy` (the API's Docker image) and
electron-builder (the POS installer) both read when deciding what to carry
along, and `resolveFont()` in `tax-document.ts` finds them by walking up from
its own `__dirname` — never from an app-specific path.
