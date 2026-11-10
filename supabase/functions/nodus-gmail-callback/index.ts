// nodus-gmail-callback: where Google sends the browser after "Allow" on the Gmail consent screen.
// It checks the one-time state that nodus-send's `connect` action created (10-minute life), exchanges the code for a
// refresh token with GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET, and stores it in public.gmail_connection (service role
// only, RLS with no policies). The token is never shown or logged. verify_jwt is off because Google's redirect carries
// no Supabase login; the state is what proves the request came from Kuran's console.
import { createClient } from "jsr:@supabase/supabase-js@2";

const REDIRECT = "https://tfsioiuvmyuqgajxtklv.supabase.co/functions/v1/nodus-gmail-callback";
const CONSOLE = "https://kbiz96.github.io/nodus-console/";

const page = (title: string, text: string, ok: boolean) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<body style="font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 16px;color:#111">` +
      `<h1 style="font-size:22px">${ok ? "✅" : "⚠️"} ${title}</h1><p style="font-size:16px;line-height:1.5">${text}</p>` +
      `<p><a href="${CONSOLE}">Back to the console</a></p></body>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const err = url.searchParams.get("error");
  if (err) return page("Gmail not connected", `Google said: ${err.replace(/[<>&"]/g, "")}. Nothing was changed.`, false);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return page("Gmail not connected", "The link is missing its code. Start again from the console.", false);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: st } = await db.from("gmail_oauth_state").delete().eq("state", state).gte("created_at", since).select("state");
  if (!st?.length) return page("Gmail not connected", "This link has expired or was already used. Start again from the console.", false);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: Deno.env.get("GMAIL_CLIENT_ID")!, client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
      redirect_uri: REDIRECT, grant_type: "authorization_code",
    }),
  });
  const d = await res.json().catch(() => ({})) as { refresh_token?: string; access_token?: string; scope?: string; error?: string; error_description?: string };
  if (!res.ok || !d.access_token) {
    return page("Gmail not connected", `Google refused the exchange (${(d.error ?? res.status) + (d.error_description ? `: ${d.error_description}` : "")}).`, false);
  }
  if (!d.refresh_token) {
    return page("Gmail not connected", "Google did not return a long-lived key. Start again from the console (it asks Google for one each time).", false);
  }
  // Which mailbox this is.
  let email: string | null = null;
  try {
    const p = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${d.access_token}` } });
    email = ((await p.json()) as { emailAddress?: string }).emailAddress ?? null;
  } catch { /* optional */ }
  const { error } = await db.from("gmail_connection").upsert({ id: 1, refresh_token: d.refresh_token, email, scopes: d.scope ?? null, updated_at: new Date().toISOString() });
  if (error) return page("Gmail not connected", "The key could not be saved. Try again from the console.", false);
  return page("Gmail connected", `Send in the console now goes out from ${email ?? "your Gmail"}: capital from kuran@nodus.partners, everything else from info@nodus.equipment. You can close this tab.`, true);
});
