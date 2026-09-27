# WhatsApp

Runbook for connecting a Meta Cloud API number to this platform.

Three systems are involved and you will move between them in order: **Meta's
App Dashboard**, the **VPS**, and the **admin panel** at
`pos.devsfleet.com/whatsapp`.

```
WhatsApp user
     │  message
     ▼
Meta Cloud API ──webhook──► POST /api/v1/whatsapp/webhook   (@Public, HMAC-verified)
     ▲                            │
     │                            ▼
     └────────send───────  whatsapp_messages / whatsapp_conversations
                                  │
                                  ▼
                       admin panel /whatsapp  (human reads and replies)
```

---

## What works today

| Capability | State |
| --- | --- |
| Receive text messages | **Working** |
| Reply with free-form text, inside 24h | **Working** |
| Configure numbers from the admin panel | **Working** |
| Template messages (reopen a closed window) | Not built |
| Media (images, documents) downloaded to MinIO | Not built |
| Delivery receipts (sent → delivered → read) | Acknowledged, not recorded |
| AI auto-reply | Not built — a person answers |

`DEEPSEEK_API_KEY` in `apps/api/.env` is **not used by WhatsApp**. `LlmService`
exists but nothing calls it; setting the key changes nothing until the
WhatsApp↔AI bridge is written.

---

## 1. Create the Meta app

In the [Meta App Dashboard](https://developers.facebook.com/apps):

1. **Create App** → name and contact email.
2. Use case: **Connect with customers through WhatsApp** → Next.
3. Pick or create a business portfolio → **Create app**.

You land on **Customize use case → Connect on WhatsApp → Quickstart**.

## 2. Find the use-case console

Meta has two navigations in the wild. Newer apps have **no "WhatsApp" item in
the left sidebar** — the settings live inside the use case:

**Dashboard → "Customize the Connect with customers through WhatsApp use case"**
(or **Use cases** in the sidebar) → **Basic setup → Step 2. Production setup**

The URL looks like `/use_cases/customize/wa-configurations-v2/`.

Older apps instead have **WhatsApp → API Setup** in the sidebar, which prints
the phone number ID directly under the **From** dropdown. If you have that
page, take the ID from there and skip step 3.

## 3. Collect the four values

The `wa-configurations-v2` console does **not** display the phone number ID
anywhere, which is the single most common place to get stuck.

| Value | Where |
| --- | --- |
| **Access token** | *Send message → Step 1 → **Generate token***. This one is permanent — no system user needed. |
| **WhatsApp Business account ID** | Printed in the *Add payment to send business-initiated messages* card. |
| **Phone number ID** | Not shown. Query it (below). |
| **App secret** | **App settings → Basic → App secret → Show**. |
| **Verify token** | You invent it: `openssl rand -hex 32`. |

Ask the API for the phone number ID, using the token and WABA ID above:

```bash
curl -s "https://graph.facebook.com/v23.0/WABA_ID/phone_numbers?access_token=TOKEN"
```

```json
{ "data": [ { "id": "779418925277868", "display_phone_number": "+971 50 671 4572" } ] }
```

`id` is the **Phone number ID**; `display_phone_number` is the **Display
number**. They are different fields and are not interchangeable — the ID is
what routes inbound webhooks and what every send is posted to.

> If the console offers a system-user fallback ("Having trouble generating a
> token?"), that path still works: Business Settings → System users → Generate
> token with `business_management`, `whatsapp_business_messaging` and
> `whatsapp_business_management`.

## 3b. Publish the app, or nothing will arrive

The *Configure Webhooks* card warns:

> Apps will only be able to receive test webhooks sent from the app dashboard
> while the app is unpublished. No production data, including from app admins,
> developers or testers, will be delivered unless the app has been published.

An unpublished app can therefore pass Meta's handshake and still deliver
nothing — no error, no log line, just silence. Check the **Publish** state
before debugging the webhook.

## 4. Register the number in the admin panel

`pos.devsfleet.com/whatsapp` → **Setup**. Requires `settings:write`, which only
the admin role holds.

Paste all four values and save.

Do this **before** step 5. With no account row the webhook rejects Meta's
handshake outright, so verification cannot succeed.

Secrets are write-only: they are stored server-side and never returned to the
browser. The panel shows only whether each is set.

## 5. Point Meta at the webhook

App Dashboard → **WhatsApp → Configuration → Webhook → Edit**:

- **Callback URL**: `https://pos-api.devsfleet.com/api/v1/whatsapp/webhook`
- **Verify token**: the same string from step 4

**Verify and save.** Meta sends a `GET` with a challenge; the API echoes it
back as plain text. A green tick means the handshake passed.

Then **Manage** the webhook fields and subscribe to **`messages`**. Without
that subscription the handshake succeeds and no message ever arrives.

## 6. Open a conversation and reply

A conversation can only start from the customer's side — the 24-hour window
opens when *they* message *you*.

1. From your own phone, send a message to the business number.
2. `pos.devsfleet.com/whatsapp` → the conversation appears, marked **Open**.
3. Type a reply and send.

Testing in the other order looks broken: with no inbound message there is no
conversation, and nothing to reply to.

---

## Verifying each stage

Run on the VPS. Each isolates one hop.

**Is the endpoint reachable at all?** Expect `403` — a rejected token proves
routing and TLS work even before any account exists.

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://pos-api.devsfleet.com/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123"
```

**Does the real verify token pass?** Expect the challenge echoed back:

```bash
curl -s "https://pos-api.devsfleet.com/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=hello"
# → hello
```

**Is the access token valid?** Expect `200`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://graph.facebook.com/v23.0/PHONE_NUMBER_ID" \
  -H "authorization: Bearer ACCESS_TOKEN"
```

**Are messages landing in the database?**

```bash
cd /var/www/devsfleet/pos && set -a; . ./.env; set +a
psql "$DATABASE_URL_MIGRATOR" -c \
  "SELECT direction, status, left(content,40) AS body, occurred_at
     FROM whatsapp_messages ORDER BY occurred_at DESC LIMIT 10;"
```

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Handshake fails in Meta's UI | No account row yet, or verify token mismatch. Do step 4 first. |
| Handshake passes, no messages arrive | Either the app is unpublished (see 3b) or the `messages` field is not subscribed (step 5). |
| Messages arrive, replies say *Not delivered* | Token expired (temporary instead of system user), or missing `whatsapp_business_messaging`. |
| Reply box replaced by a window notice | More than 24h since their last message. Needs a template — not built. |
| Nothing at all, `curl` returns 502/523 | The API is not up. Check PM2 and nginx, not WhatsApp. |

Failed sends are stored, not discarded — the message row keeps `status:
"failed"` and Meta's own error text, so the thread shows what was attempted.
This is deliberate: without it, an operator retypes a reply believing the first
never left.

---

## Where the code lives

| Piece | File |
| --- | --- |
| Public webhook (verify + receive) | `apps/api/src/modules/whatsapp/whatsapp.controller.ts` |
| Config + inbox routes | `apps/api/src/modules/whatsapp/whatsapp-admin.controller.ts` |
| Signature check, persistence, send | `apps/api/src/modules/whatsapp/whatsapp.service.ts` |
| Admin UI | `apps/admin/src/app/whatsapp/page.tsx` |
| Tables | `packages/db/src/schema/whatsapp.ts` |

Graph API version is pinned in `whatsapp.service.ts` (`GRAPH_API_VERSION`).
Meta retires versions on a published schedule — check it against their docs
when touching this module.
