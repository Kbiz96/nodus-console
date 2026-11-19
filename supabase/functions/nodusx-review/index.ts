// nodusx-review: the console's NodusX screening desk. Every listing submitted on nodus.partners/nodusx is reviewed here
// before anything is published.
// Actions:
//   decide {id, decision, public_note?, reason?, info?, review_note?, diligence?, email?: {to, subject, body}}
//     decision: approve | verify | reject | info | withdraw | reopen | private | save
//     Records the decision through nodusx_decide (RLS, Kuran only), then, when an email is given, sends it from
//     info@nodus.equipment in Kuran's name through the connected Gmail and stamps decision_emailed_at.
//   email {id, email: {to, subject, body}}   Sends a further email on a listing (for example a reminder) and logs it.
// Auth: the gateway verifies the JWT; nodus_is_kuran() must be true. Every read and write runs as that user.
// Never mentions fees or prices: the console composes the text, Kuran edits it, this function only sends it.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { FROM_DEFAULT, buildMessage } from "./mail.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
const fail = (reason: string, extra: Record<string, unknown> = {}) => json(200, { ok: false, reason, ...extra });
const DECISIONS = ["approve", "verify", "reject", "info", "withdraw", "reopen", "private", "save"];

const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

let token: { value: string; until: number } | null = null;
async function accessToken(): Promise<string> {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const { data } = await admin().from("gmail_connection").select("refresh_token").eq("id", 1).maybeSingle();
  const rt = (data?.refresh_token as string | undefined) ?? Deno.env.get("GMAIL_REFRESH_TOKEN");
  if (!rt) throw new Error("Gmail is not connected: use Connect Gmail in the console.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GMAIL_CLIENT_ID")!, client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!, refresh_token: rt, grant_type: "refresh_token" }),
  });
  const d = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !d.access_token) throw new Error(`Gmail refused the key: ${d.error ?? res.status}`);
  token = { value: d.access_token, until: Date.now() + (d.expires_in ?? 3000) * 1000 };
  return token.value;
}

type Mail = { to: string; subject: string; body: string };
function cleanMail(v: unknown): Mail | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  const to = String(m.to ?? "").trim().toLowerCase(), subject = String(m.subject ?? "").trim(), body = String(m.body ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || subject.length < 3 || body.length < 10) return null;
  return { to, subject: subject.slice(0, 200), body: body.slice(0, 8000) };
}

async function sendMail(db: SupabaseClient, id: string, mail: Mail, decision: string) {
  const raw = buildMessage({ from: FROM_DEFAULT, to: mail.to, subject: mail.subject, body: mail.body });
  const res = await fetch(`${GMAIL}/messages/send`, {
    method: "POST", headers: { Authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" }, body: JSON.stringify({ raw }),
  });
  const d = await res.json().catch(() => ({})) as { id?: string; threadId?: string; error?: { message?: string } };
  if (!res.ok || !d.id) throw new Error(`Gmail did not send: ${d.error?.message ?? res.status}`);
  const stamp = { ...mail, decision, gmail_id: d.id, thread_id: d.threadId, at: new Date().toISOString() };
  await db.from("board_listings").update({ decision_emailed_at: stamp.at, decision_email: stamp }).eq("id", id);
  return stamp;
}

async function decide(db: SupabaseClient, b: Record<string, unknown>) {
  const id = String(b.id ?? ""), decision = String(b.decision ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id) || !DECISIONS.includes(decision)) return fail("bad_request", { message: "id and a known decision are required" });
  const mail = b.email ? cleanMail(b.email) : null;
  if (b.email && !mail) return fail("bad_email", { message: "The email needs a valid address, a subject and a body." });
  const s = (k: string) => (typeof b[k] === "string" && (b[k] as string).trim() ? (b[k] as string).trim() : null);
  const { data: row, error } = await db.rpc("nodusx_decide", {
    p_id: id, p_decision: decision, p_public_note: s("public_note"), p_reason: s("reason"), p_info: s("info"), p_review_note: s("review_note"),
    p_diligence: b.diligence && typeof b.diligence === "object" ? b.diligence : null,
  });
  if (error) return fail("db", { message: error.message });
  let sent = null;
  if (mail) {
    try { sent = await sendMail(db, id, mail, decision); }
    catch (e) { return json(200, { ok: true, row, emailed: false, message: `Decision saved, but the email did not go: ${e instanceof Error ? e.message : e}` }); }
  }
  return json(200, { ok: true, row, emailed: Boolean(sent) });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { ok: false, reason: "method_not_allowed" });
  const auth = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/.test(auth)) return json(401, { ok: false, reason: "unauthorised" });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: allowed, error: ae } = await db.rpc("nodus_is_kuran");
  if (ae || allowed !== true) return json(403, { ok: false, reason: "not_allowed" });
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return fail("bad_request", { message: "JSON body expected" }); }
  try {
    if (b.action === "decide") return await decide(db, b);
    if (b.action === "email") {
      const id = String(b.id ?? ""), mail = cleanMail(b.email);
      if (!/^[0-9a-f-]{36}$/.test(id) || !mail) return fail("bad_request", { message: "id and a complete email are required" });
      return json(200, { ok: true, sent: await sendMail(db, id, mail, "email") });
    }
    return fail("unknown_action");
  } catch (e) {
    return fail("error", { message: e instanceof Error ? e.message.slice(0, 300) : "unexpected error" });
  }
});
