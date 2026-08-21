# Bundled fonts

`NotoSansArabic-Regular.ttf`, `NotoSansArabic-SemiBold.ttf` — Google Noto,
licensed under the SIL Open Font License 1.1 (https://openfontlicense.org).

Bundled rather than resolved from the host because the API runs in a container
that has no system fonts: without these, the Arabic labels on a tax invoice
render as tofu boxes. Latin text uses PDF's built-in Helvetica, which needs no
embedding — these two files exist only for the Arabic.

Kept in sync with `apps/api/nest-cli.json`'s `assets` list, which copies them
into `dist/` on build.
