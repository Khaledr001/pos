# WhatsApp Embedded Signup and coexistence — operator setup

This is the one-time setup **DevsFleet** does in Meta so that businesses can
connect WhatsApp by logging into Meta in a popup ("Connect with Meta"), instead
of creating their own Meta app and pasting credentials. It also unlocks
**coexistence**: a business keeps using its number in the WhatsApp Business app
on the phone while the same number is connected here.

Until all four server settings below are present, the admin panel says the
option isn't switched on and offers the manual setup. Nothing breaks.

> Meta changes this product often. Every Meta-specific name the code uses lives
> in `apps/api/src/modules/whatsapp/meta-embedded.ts` (mirrored in
> `apps/admin/src/app/whatsapp/embedded-signup.tsx`). Check it against Meta's
> current docs before going live — see [Open questions](#open-questions).
>
> - https://developers.facebook.com/docs/whatsapp/embedded-signup
> - https://developers.facebook.com/docs/whatsapp/embedded-signup/onboarding-business-app-users

## 1. Meta-side checklist

1. **Business Verification** of the DevsFleet business in Meta Business Suite →
   Settings → Security Center. This usually takes days, so start it first.
2. **Create the app**: Meta for Developers → Create app → type **Business**,
   owned by the verified DevsFleet business.
3. **Add products** to the app:
   - **WhatsApp**;
   - **Facebook Login for Business**.
4. **Embedded Signup configuration**: Facebook Login for Business →
   Configurations → Create configuration → choose the WhatsApp Embedded Signup
   login variation, with the permissions below. The configuration's **ID** is
   `META_EMBEDDED_SIGNUP_CONFIG_ID`.
5. **Permissions / App Review**: request **Advanced Access** for
   - `whatsapp_business_management`;
   - `whatsapp_business_messaging`;
   - `business_management`, if Meta asks for it for your flow.

   App Review needs a screencast of the flow; record "Connect WhatsApp" in this
   admin panel against a test number.
6. **Tech Provider onboarding**: complete Meta's Tech Provider (or Solution
   Partner) steps for the app. Embedded Signup for other businesses' numbers
   requires it.
7. **Allowed domains**: in Facebook Login for Business settings, add the admin
   panel's HTTPS domain. Meta's SDK refuses to open the popup on unlisted
   domains, and **localhost won't work**.
8. **App webhook**: the app → WhatsApp → Configuration:
   - Callback URL: `https://<your-api-host>/api/v1/whatsapp/webhook`
   - Verify token: the value you put in `META_WEBHOOK_VERIFY_TOKEN`
   - Subscribe the webhook fields: **messages**, and for coexistence
     **smb_message_echoes**, **history** and **smb_app_state_sync**.

   Meta calls the URL to verify it as you save, so the API must already be
   deployed with the env vars below.
9. **App mode**: switch the app to **Live** once review is approved.

## 2. Server settings

Set these in the API's environment (`.env` on the VPS) and restart the API:

| Variable | What it is |
|---|---|
| `META_APP_ID` | The app's numeric App ID (App settings → Basic). |
| `META_APP_SECRET` | The app's App Secret. **Server only**: it signs every webhook for numbers connected this way and exchanges the signup code. It is never sent to a browser. |
| `META_EMBEDDED_SIGNUP_CONFIG_ID` | The configuration ID from step 4. |
| `META_WEBHOOK_VERIFY_TOKEN` | Any long random string; the same value you type into the app's webhook settings in step 8. |

The admin panel also needs `NEXT_PUBLIC_API_URL` to be the public HTTPS API
address, as before.

The admin panel's Content Security Policy allows Meta's SDK
(`connect.facebook.net`, `*.facebook.com`) on the `/whatsapp` page only. If you
put a proxy or CDN in front that rewrites CSP, keep that allowance.

## 3. How a connection works

1. The shop clicks **Connect WhatsApp** and chooses one of:
   - **Use my existing WhatsApp Business app number**, for coexistence;
   - **Connect a new number**.
2. Meta's popup opens. The shop logs in, picks or creates its business, and
   either scans a QR code with the WhatsApp Business app (coexistence) or
   verifies a new number by SMS or voice.
3. The browser receives a one-time code and the chosen IDs, and sends them to
   `POST /api/v1/whatsapp/embedded-signup/complete`. The API then:
   - exchanges the code for a business token using the app secret;
   - checks with `debug_token` that the token was really granted that business
     account. The IDs from the browser are not trusted until then;
   - confirms the number belongs to that account, and that no other business on
     DevsFleet already has it;
   - subscribes the app to the account's webhooks;
   - **new number**: registers it with a generated 6-digit PIN, which is stored
     on the account row;
   - **coexistence**: does **not** register it, because that would sign the
     phone app out. Instead it requests the contacts and chat-history sync, which
     arrive later on the webhook;
   - saves the number as connection method `embedded`.

Numbers connected this way have no app secret or verify token of their own.
Their webhooks are verified with `META_APP_SECRET`. Manually connected numbers
keep working exactly as before, with their own secrets.

## 4. Testing

- **Before App Review**, Meta lets the app's own admins, developers and testers
  complete Embedded Signup. Add a tester and use a spare number.
- **Coexistence test:** install the WhatsApp Business app on a test phone with a
  number that has been in active use, then choose "Use my existing WhatsApp
  Business app number". Afterwards check:
  - a message sent from the phone shows in the conversation marked **Sent from
    phone**;
  - a customer message shows from both sides;
  - past chats appear marked **Imported** within a few minutes.
- **API logs** to watch: "Stored messages sent from the phone app", "Imported a
  chunk of WhatsApp chat history", "Applied contact names from the phone app".
  A signature failure logs "REJECTED a webhook with an invalid signature".

## 5. Coexistence — what to tell customers

- **Keep the WhatsApp Business app installed** and open it regularly. Meta
  unlinks the number if the app stays unused for a while (roughly two weeks at
  the time of writing).
- **Chat history:** only the recent period Meta allows (about 6 months) is
  imported, once, at connection time. Media in history may not come across.
- **Phone-app features:** Meta disables some for linked numbers, e.g. certain
  broadcast lists, disappearing messages and view-once. Check Meta's current
  list.
- **Replying from here** follows WhatsApp's 24-hour rule. Replies typed on the
  phone are not limited this way, and they show up here.
- **Availability** depends on Meta, by country and by number type. Confirm the
  UAE is supported before promising it.

## 6. Open questions

These are about Meta's details, which the code assumes but which couldn't be
verified without a live, approved app:

1. **Session-info events**, in `meta-embedded.ts` and `embedded-signup.tsx`:
   - The coexistence feature type is assumed to be
     `whatsapp_business_app_onboarding` with `sessionInfoVersion: "3"`.
   - The finish event for coexistence is assumed to be
     `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`. Any `FINISH*` event carrying
     both IDs is accepted.

   Check both against the current Embedded Signup docs.
2. **Sync endpoint:** assumed to be `POST /{phone-number-id}/smb_app_data` with
   `sync_type` set to `smb_app_state_sync` (contacts) and `history`. Check:
   - the exact names;
   - the 24-hour window;
   - whether the history request must wait until the owner approves sharing in
     the app.
3. **Webhook shapes**, in `coexistence.ts`:
   - `smb_message_echoes` carries a `message_echoes[]` array with `to`;
   - `history` carries `history[].threads[].messages[]`, with `errors[]` when
     the owner declines;
   - `smb_app_state_sync` carries `state_sync[].contact`.

   The parsers skip anything they don't recognise rather than failing, so a
   changed shape shows up as missing messages in the logs, not as errors.
4. **Registration PIN:** whether Meta now requires the PIN on
   `/{phone}/register` for numbers onboarded through Embedded Signup, or sets
   two-step verification itself.
5. **Business token lifetime:** the token from the code exchange is a "business
   integration system user" token, assumed long-lived. If Meta now expires it,
   a refresh path is needed. The account's health badge will show it.
