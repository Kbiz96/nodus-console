# Connect Gmail to the console's Send button (one time, about 10 minutes)

Send in the console goes out from your Gmail: capital from **kuran@nodus.partners**, everything else from
**info@nodus.equipment**. It needs one Google key, made once, signed in as **info@nodus.equipment**.
Nothing here costs money.

## 1. Make the Google app (5 minutes)

1. Open https://console.cloud.google.com signed in as **info@nodus.equipment**. Top bar → project picker → **New project**,
   name it `Nodus Mail` → **Create**, then select it.
2. Search bar → **Gmail API** → **Enable**.
3. Left menu **Google Auth Platform** (or *APIs & Services → OAuth consent screen*) → **Get started**:
   app name `Nodus Console`, support email info@nodus.equipment, **Audience: Internal**, contact email the same → **Create**.
   Internal means only your nodus.equipment accounts can use it, and the key does not expire every 7 days.
4. **Clients → Create client** → type **Web application**, name `Nodus send`.
   Under **Authorised redirect URIs** add exactly: `https://developers.google.com/oauthplayground` → **Create**.
   Keep the **Client ID** and **Client secret** open.

## 2. Get the key (3 minutes)

1. Open https://developers.google.com/oauthplayground
2. Gear icon (top right) → tick **Use your own OAuth credentials** → paste the Client ID and Client secret → close.
3. Left side, box **Input your own scopes**, paste this one line and press **Authorize APIs**:
   `https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.settings.basic`
4. Sign in as **info@nodus.equipment** → **Allow**.
5. Press **Exchange authorization code for tokens** → copy the **Refresh token**.

## 3. Put the three values in Supabase (2 minutes)

Supabase → project **NODUS2** → **Edge Functions → Secrets** → add:

| Name | Value |
|---|---|
| `GMAIL_CLIENT_ID` | the Client ID |
| `GMAIL_CLIENT_SECRET` | the Client secret |
| `GMAIL_REFRESH_TOKEN` | the Refresh token |
| `SEND_DAILY_CAP` | optional, default 50 |

## 4. Check the alias

Gmail (info@nodus.equipment) → Settings → **Accounts** → **Send mail as** must list **kuran@nodus.partners** with no
"unverified" label. If it is missing: **Add another email address**, name `Kuran Sailopal`, address
`kuran@nodus.partners`, tick "Treat as an alias", and confirm.

## 5. Test

In the console, press Send on one draft. The confirmation says which address it went from. If anything is not set up,
the console says exactly what, and nothing is sent.

To switch it off: delete `GMAIL_REFRESH_TOKEN` from the Supabase secrets (or remove the app at
https://myaccount.google.com/permissions).
