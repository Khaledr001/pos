# UAE e-invoicing

How the platform produces, validates and sends UAE e-invoices (PINT AE over
Peppol), what it deliberately does not do, and how to run it.

Code: [`apps/api/src/modules/einvoice/`](../apps/api/src/modules/einvoice/).
Shared vocabulary: [`packages/shared-types/src/einvoice.ts`](../packages/shared-types/src/einvoice.ts).

> **Not tax or legal advice.** The dates below come from secondary sources
> (consultancy and news sites, retrieved October 2026), not from the Ministry of
> Finance text. Re-verify them, and the data requirements, against the official
> Ministerial Decisions and the PINT AE specification before relying on them.

---

## The regime, as understood in October 2026

| Who                              | Appoint an accredited service provider (ASP) by                                          | Mandatory from |
| -------------------------------- | ---------------------------------------------------------------------------------------- | -------------- |
| Revenue ≥ AED 50 million        | 30 Oct 2026 (moved from 31 Jul by Ministerial Decision 66 of 2026, amending 244 of 2025) | 1 Jan 2027     |
| Everyone else (< AED 50 million) | 31 Mar 2027                                                                              | 1 Jul 2027     |
| Government entities              | 31 Mar 2027                                                                              | 1 Oct 2027     |

- A voluntary **pilot** opened on 1 Jul 2026.
- **B2C is outside the mandate** until a date the Minister sets. B2B and B2G
  invoices (and the credit notes that correct them) are what this covers.
- The legal basis is Ministerial Decisions 243 and 244 of 2025 under the VAT law.
- The model is a **five-corner Peppol exchange**: the supplier's system produces
  a PINT AE document and hands it to its ASP; the ASP exchanges it with the
  buyer's ASP over Peppol and reports the data to the Federal Tax Authority. A
  business **cannot connect to Peppol directly** — it must go through an
  accredited ASP.

The format is **PINT AE** (Peppol International Invoicing Model, UAE
localisation), a UBL 2.1 document. This implementation targets version
**1.0.4**; the constant lives in
[`pint-ae/constants.ts`](../apps/api/src/modules/einvoice/pint-ae/constants.ts)
(`PINT_AE_VERSION`) together with every literal taken from the specification.

## What the platform does and does not do

**Does**

- Decides which invoices and credit notes need e-invoicing (see Eligibility).
- Freezes everything a document is built from, builds the PINT AE XML,
  validates it against the specification's rules, and stores the XML and its
  SHA-256 as the legal original.
- Sends it to the business's ASP through a pluggable connector and tracks the
  result: queued → submitting → submitted → delivered, or rejected / failed.
- Shows staff exactly what to fix when a document is rejected, and rebuilds it
  from the corrected data on retry.
- Refuses to void an invoice that has gone out (the correction is a credit note).

**Does not**

- **Is not an ASP.** Accreditation is a separate legal step. This module is the
  supplier-side system that feeds an ASP.
- Ship connectors for any named ASP. Each publishes its own API. The `gateway`
  driver is the slot where one goes, plus a documented generic contract (below).
- Report B2C sales, reverse-charge (`AE`) or additional-VAT (`N`) supplies,
  free-trade-zone, deemed, margin-scheme, summary, continuous, agent-billing,
  e-commerce or export transaction types. Every document is a plain B2B supply
  (`ProfileExecutionID` `00000000`). Categories supported: `S`, `Z`, `E`, `O`.
- Hold a bank account number for the seller, so a bank transfer is reported as
  payment means `1` ("instrument not defined"), not `30` (which PINT AE
  requires an IBAN for).

## Document lifecycle

```
   sale or return issued (same transaction)
              │ enqueueForSale — only if eligible
              ▼
        ┌──────────┐  Send (when held)   held for review (autoSubmit off)
        │  queued  │◄─────────────────────────────────────────┐
        └────┬─────┘                                          │
             │ sweep (every 30 s) claims it                   │
             ▼                                                │
   build snapshot → validate ──errors──► ┌──────────┐         │
             │                           │ rejected │─ Retry ─┤ (rebuilt from current data)
             │ ok: store XML + hash      └──────────┘         │
             ▼                                 ▲              │
       ┌────────────┐  provider rejects ───────┘              │
       │ submitting │  (frozen from here: XML can't change)   │
       └─────┬──────┘                                         │
             │ accepted                transient error        │
             ▼                         ──► back to queued with backoff
       ┌───────────┐                       1 m, 5 m, 15 m, 1 h, 6 h
       │ submitted │                       after 6 attempts ──► ┌────────┐
       └─────┬─────┘                                            │ failed │─ Retry ─► queued
             │ provider callback: delivered                     └────────┘
             ▼
       ┌───────────┐         cancelled: the sale was voided before anything was sent
       │ delivered │
       └───────────┘
```

Every transition writes an `einvoice_events` row (append-only). The database
itself enforces that a document is never deleted, its identity (`uuid`, sale,
number, type) never changes, and once it is `submitting`, `submitted` or
`delivered` its XML, hash and snapshot are frozen — a trigger, not a convention.

A document is **claimed** with `FOR UPDATE SKIP LOCKED` by leasing it (next
attempt pushed out ten minutes), so any number of API instances can sweep. The
status becomes `submitting` only after the XML is stored. A document stuck
`submitting` for more than ten minutes (a worker died) is re-sent with its stored
XML; the provider de-duplicates on the document `uuid` (BTAE-07).

## Eligibility (`eligibility.ts`)

A sale or return is queued only when **all** hold:

1. E-invoicing is switched on for the business, and the sale's date (business
   timezone) is on or after the start date, if one is set.
2. It is not voided.
3. An **invoice** goes to a business customer that quotes a TRN. No customer, or
   no TRN, means B2C: no document, and a till sale is never held up. A TRN that
   is present but malformed *still qualifies* — it fails validation visibly in the
   register instead of the customer silently never being reported.
4. A **credit note** (a return) is queued exactly when the invoice it corrects was
   e-invoiced, whoever the customer is today.

## Data a valid document needs

Everything below was checked against the specification's Schematron. A missing
item makes the document `rejected` with a message naming the fix and where (the
`field` of each issue points at the admin place: `settings.trn`,
`settings.legalAddress`, `customer.address`, `product.taxCategory`…).

**The business** (Settings and E-invoicing settings)

- Legal name.
- TRN: 15 digits, **starting 1 and ending 03** (rule IBR-132).
- Structured address: street, city, **emirate** (`AUH DXB SHJ UAQ FUJ AJM RAK`,
  IBR-128), country.
- Peppol address: derived from the TRN (scheme `0235` + the first ten digits, the
  TIN) unless set explicitly.
- **Trade licence** (or Emirates ID / passport / cabinet decision) number, its
  type and issuing authority (IBR-150, IBR-172, IBR-173).

**The customer** (customer record)

- Name (company name preferred), valid TRN, structured address with emirate.

**Each line** (product and unit)

- A **tax category**: `S` standard (rate must be exactly 5%, IBR-190), `Z` zero,
  `E` exempt (needs an exemption reason code, IBR-167), `O` out of scope.
  An invoice needs at least one `S` or `Z` line (IBR-151).
- A **UN/ECE Recommendation 20/21 unit code** (rule IBR-CL-23): `C62` each,
  `MTR`, `KGM`, `LTR`, … and `XBX` box, `XPK` package, `XRO` roll. Plain `BX`,
  `PK`, `ROL` are **not** valid — the list is embedded in
  [`pint-ae/unit-codes.ts`](../apps/api/src/modules/einvoice/pint-ae/unit-codes.ts).

**A credit note** also needs a reason (`DL8.61.1.A–E` or `VD`) and refers to the
invoice it corrects (except volume discount `VD`, which must not, IBR-055).

**Foreign-currency documents** need a currency→AED rate (≤ 6 decimals); the XML
then carries the AED VAT, AED total and AED line amounts (IBR-159, IBR-175).

### How the figures are built

Every number comes from the line snapshots the platform stored for the sale —
**never recomputed a second way**. Nets and VAT per line are used as issued;
totals are their sums in exact integer arithmetic; the VAT breakdown is those
same lines grouped by category and rate. Discounts become a line allowance equal
to *gross − net*, and the price block is derived so that
*net = quantity × price − allowance* holds by construction (IBR-147). A return,
stored negative, becomes a positive credit note.

**Known limitation — per-line VAT rounding.** The platform rounds VAT once per
line. PINT AE requires the VAT on each standard-rated breakdown to equal
*rate × taxable amount* to within **0.02** (rule `aligned-ibrp-s-09`). On an
invoice with many lines the per-line rounding can drift past that. The validator
detects it (`VAT_ROUNDING_DEVIATION`) and the document is held as `rejected` with
an explanation — it is **never silently altered**, because the PDF tax invoice the
customer holds shows the same figures. The durable fix is for `calculateDocument`
to compute VAT per (category, rate) group on the document and spread the rounding
residue onto lines; that changes every document the platform issues, so it needs
a decision. Until then, large many-line invoices can be rejected for this reason.

## Providers

`einvoice_accounts` holds one connection per business: `sandbox` (default) or
`gateway`.

**Sandbox** accepts everything and confirms delivery without leaving the
building. It is how a business rehearses the whole flow, and what development and
the tests use. Sandbox documents are stamped `mode = sandbox` and are never a
report to the authority.

**Live mode** requires a connected non-sandbox provider, a valid TRN, a complete
address and the trade licence; enabling it without them is refused with a list of
what is missing.

### Gateway contract

The generic connector, for an ASP (or a small adapter in front of one) to meet.
Real ASPs each have their own API; a connector for a specific one replaces
`GatewayProvider`. **Being (or choosing) an accredited ASP is a separate legal
step this module does not perform.**

```
POST <endpointUrl>
Authorization: Bearer <credential>
X-Signature:   sha256=<hex HMAC-SHA256 of the raw request body, key = credential>
Content-Type:  application/json

{ "uuid", "docType": "invoice"|"credit_note", "documentNumber", "issuedAt",
  "xmlBase64", "xmlSha256", "sandbox": true|false }
```

Reply `2xx` JSON `{ "id": "<your reference>", "status": "accepted"|"delivered"|"rejected", "errors": [{ "code", "message" }] }`.

| Provider says                            | Platform does                                     |
| ---------------------------------------- | ------------------------------------------------- |
| 2xx `accepted`                         | → `submitted`                                  |
| 2xx `delivered`                        | → `delivered`                                  |
| 2xx `rejected`, or 4xx with `errors` | → `rejected`, errors shown to staff            |
| 401 / 403                                | → `failed` (credentials), no retry until fixed |
| 408 / 429 / 5xx, timeout, network error  | retry with backoff, then `failed`               |
| 3xx                                      | → `failed` (redirects are never followed)      |

`uuid` is the idempotency key: submitting it twice must not report twice.
A test message (`{ "type": "ping" }`, same headers) is sent by *Test connection*.

**Status callbacks.** After acceptance the provider reports later events to
`POST /api/v1/einvoice/callback/<token>` (the path is shown in the admin; the
token is per business and unguessable) with
`{ "id": "<the reference you returned>", "status": "accepted"|"delivered"|"rejected", "errors": [...] }`
and the same `X-Signature` over the raw body. The token **and** the signature
are both required. Reports are idempotent and tolerant of ordering: a status never
moves a document backwards, and a repeat is a no-op.

### Security

- **Credentials** are encrypted at rest with AES-256-GCM
  ([`common/crypto/secret-box.ts`](../apps/api/src/common/crypto/secret-box.ts),
  envelope `v1:<iv>:<tag>:<ciphertext>`), keyed from `APP_ENCRYPTION_KEY`. They are
  write-only: no endpoint returns them, and they are never logged. This box is
  used only for the e-invoicing provider today; the WhatsApp and Stripe
  credentials are still stored as before and remain a follow-up.
- **The endpoint URL is tenant-supplied**, so outbound calls are SSRF-guarded
  ([`providers/ssrf.ts`](../apps/api/src/modules/einvoice/providers/ssrf.ts)):
  https only, no credentials in the URL, every resolved address checked against
  private/loopback/link-local/metadata ranges *and the checked address is the one
  connected to* (no DNS rebinding), no redirects, 15 s timeout, 1 MB response cap.
- The callback is authenticated twice (token + HMAC of the raw body) and gives
  the same answer for an unknown token and a bad signature.
- Transport error messages are never copied into a document (they can name
  internal hosts); XML bodies and credentials are never logged.
- Rows are protected by row-level security like every tenant table; the sweep
  uses the platform-admin context only to find *which* tenants have work, then
  runs each under that tenant's own context.

## Admin API

Base path `/api/v1/einvoice`. Reads of settings use `settings:read`, changes
`settings:write`; the register uses `sale:read`; **retry** and **send** (acting on
an issued document) use `sale:void`.

| Route                                          | Result                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /settings`                              | `{ settings, provider, readiness }`                                                              |
| `PUT /settings`                              | partial `{ enabled, mode, startDate, autoSubmit, endpoint, legalRegistration }` → the same view |
| `PUT /provider`                              | `{ provider, endpointUrl?, credentials? }` → provider view (credentials write-only)             |
| `POST /provider/test`                        | `{ ok, message }`                                                                                |
| `GET /readiness`                             | checks and the customers that cannot be invoiced yet                                               |
| `GET /documents?page&pageSize&status&type&q` | the register, with per-status counts                                                               |
| `GET /documents/:id`                         | issues, history, provider reference, hash                                                          |
| `GET /documents/:id/xml`                     | the XML (404 until built)                                                                          |
| `POST /documents/:id/retry`                  | rejected / failed → queued, rebuilt from current data                                             |
| `POST /documents/:id/send`                   | release a document held for review                                                                 |

## Runbook

- **Rejected.** Open the document: each issue says what and where. Fix the
  customer, product or setting, then **Retry** — it is rebuilt from the corrected
  rows. (A rejection by the provider/network is retried the same way.)
- **Failed.** Technical, after six attempts (or bad credentials). Fix the cause
  (credentials, endpoint, the provider's outage) and **Retry**.
- **Held for review.** Automatic sending is off; review and press **Send**.
- **A document stuck `submitting`.** Reclaimed automatically after ten minutes.
- **Voiding an e-invoiced sale.** Allowed only while nothing has been sent (the
  document is cancelled). Afterwards: issue a return, which becomes a credit note.
- **Changing `APP_ENCRYPTION_KEY`.** Stored provider credentials become
  unreadable; the document will fail with a message to re-enter them.
- **Moving to a new PINT AE version.** Change `PINT_AE_VERSION` and any literal in
  `pint-ae/constants.ts`, regenerate `unit-codes.ts` from the new `resources.zip`,
  and run the conformance suite (below).

## Configuration

| Variable                           | Meaning                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `APP_ENCRYPTION_KEY`             | 32 bytes (`openssl rand -hex 32`). Required in production to store provider credentials. |
| `EINVOICE_GATEWAY_ALLOW_PRIVATE` | Development only: allow a mock provider on a private address. Ignored in production.       |

Per business, in the e-invoicing settings: enabled, mode (`sandbox` / `live`),
start date, auto-submit, Peppol address override, trade licence.

## Verification

- `pnpm --filter @devsfleet/api test` runs the unit suite: the rules, the
  renderer, the validator, the providers (including the SSRF cases), the policy,
  the callbacks.
- **Conformance against the official Schematron** is opt-in so the suite stays
  hermetic. Download `resources.zip` from
  [https://docs.peppol.eu/poac/ae/pint-ae/](https://docs.peppol.eu/poac/ae/pint-ae/), extract it, and run:

  ```bash
  PINT_AE_RESOURCES=/path/to/extracted pnpm --filter @devsfleet/api test -- einvoice/pint-ae
  EINVOICE_CONFORMANCE_DOCS=400 PINT_AE_RESOURCES=… pnpm --filter @devsfleet/api test -- conformance
  ```

  The XSLT is compiled once with `xslt3` (pure JS, no Java) and cached; each
  generated invoice and credit note is then judged by the same rules the network
  applies. It runs the official examples (proving the harness can pass *and*
  fail), a set of fixed documents, and seeded random documents (mixed
  categories, discounts, inclusive and exclusive pricing, USD).
- The module was also exercised end to end against a real PostgreSQL database
  through the application role (row-level security enforced): enqueue → sweep →
  delivered; rejection → fix → retry; credit notes; hold and send; the immutability
  triggers; thirty documents swept by three concurrent sweepers sent once each;
  stuck-document reclaim; tenant isolation; and the gateway driver and callback
  against a local HTTPS mock provider.

## Known gaps

- Per-line VAT rounding can exceed PINT AE's 0.02 tolerance on large invoices
  (see above).
- The shared unit-code presets (`UNIT_CODE_PRESETS`) list `BX`, `PK`, `ROL`, which
  are not valid Recommendation 20 codes; they should be `XBX`, `XPK`, `XRO`.
- B2C, reverse charge, other transaction types and HS/SAC item classification are
  not reported.
- No connector for a named ASP; the gateway contract above is generic.
- Credentials for WhatsApp and Stripe are not yet encrypted with `SecretBox`.
