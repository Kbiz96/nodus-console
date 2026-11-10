# Gmail sending for the console (set up 10 Nov 2026)

Send in the console goes out from the info@nodus.equipment Gmail: capital from **kuran@nodus.partners**, everything
else from **info@nodus.equipment**.

## What is in place
- Google Cloud project **Nodus Mail** (signed in as info@nodus.equipment): Gmail API on, consent screen *Internal*,
  OAuth client **Nodus send** with redirect URI `https://tfsioiuvmyuqgajxtklv.supabase.co/functions/v1/nodus-gmail-callback`.
- Supabase NODUS2 secrets: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `APOLLO_API_KEY` (and an unused `GMAIL_REFRESH_TOKEN`).
- The Gmail refresh token lives in `public.gmail_connection` (RLS on, no policies: service role only).

## Reconnect Gmail (if Send ever says Google refused the connection)
Call `nodus-send` with `{action: "connect"}` from the signed-in console; it returns a Google link. Open it, sign in as
info@nodus.equipment, press Allow. The page says "Gmail connected". No keys to copy.

## Turn it off
Remove the app at https://myaccount.google.com/permissions (info@nodus.equipment), or delete the row in
`gmail_connection`.
