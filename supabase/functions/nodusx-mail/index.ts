// nodusx-mail: sends NodusX customer emails (submission confirmations, signed terms) from nodusx@nodus.partners through
// the connected Gmail, so every customer email sits in Sent and every reply lands in the same inbox under NodusX.
// Called server-side by the website (/api/board) with the shared secret in nodusx_private ('mail_secret').
// Body: {to, cc?, subject, text, html?, attachments?: [{filename, mime, content_b64}], kind?}
// If nodusx@ is not yet a verified send-as address, it sends from info@nodus.equipment instead (reply-to nodusx@).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { FALLBACK_FROM, NODUSX_FROM, buildMime, type Attachment } from "./mime.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

let secret: string | null = null;
async function mailSecret() {
  if (secret) return secret;
  const { data } = await db.from("nodusx_private").select("v").eq("k", "mail_secret").maybeSingle();
  secret = (data?.v as string | undefined) ?? null;
  return secret;
}
let tok: { v: string; until: number } | null = null;
async function token() {
  if (tok && tok.until > Date.now() + 60_000) return tok.v;
  const { data } = await db.from("gmail_connection").select("refresh_token").eq("id", 1).maybeSingle();
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GMAIL_CLIENT_ID")!, client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!, refresh_token: data?.refresh_token ?? "", grant_type: "refresh_token" }),
  });
  const d = await r.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string };
  if (!d.access_token) throw new Error(`Gmail key refused: ${d.error ?? r.status}`);
  tok = { v: d.access_token, until: Date.now() + (d.expires_in ?? 3000) * 1000 };
  return tok.v;
}
async function gmail(path: string, body?: unknown) {
  const r = await fetch(GMAIL + path, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${await token()}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`Gmail ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : {};
}
let sendAs: { list: string[]; at: number } | null = null;
async function canSendAsNodusx() {
  if (!sendAs || sendAs.at < Date.now() - 300_000) {
    const d = await gmail("/settings/sendAs");
    sendAs = { at: Date.now(), list: ((d.sendAs ?? []) as { sendAsEmail: string; isPrimary?: boolean; verificationStatus?: string }[])
      .filter((a) => a.isPrimary || a.verificationStatus === "accepted").map((a) => a.sendAsEmail.toLowerCase()) };
  }
  return sendAs.list.includes(NODUSX_FROM);
}
const okEmail = (s: unknown) => typeof s === "string" && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(s.trim());

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false });
  const s = await mailSecret();
  if (!s || req.headers.get("x-nodusx-secret") !== s) return json(401, { ok: false, reason: "unauthorised" });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json(400, { ok: false, reason: "bad_json" }); }
  if (b.action === "status") {
    try { return json(200, { ok: true, nodusx_ready: await canSendAsNodusx() }); } catch (e) { return json(200, { ok: false, message: String(e).slice(0, 200) }); }
  }
  const to = String(b.to ?? "").trim().toLowerCase();
  const subject = String(b.subject ?? "").trim().slice(0, 200);
  const text = String(b.text ?? "").trim().slice(0, 20000);
  if (!okEmail(to) || subject.length < 3 || text.length < 5) return json(400, { ok: false, reason: "bad_request" });
  const cc = (Array.isArray(b.cc) ? b.cc : []).filter(okEmail).map((x) => String(x).trim()).slice(0, 3);
  const atts = (Array.isArray(b.attachments) ? b.attachments : []).slice(0, 2) as Attachment[];
  if (atts.some((a) => typeof a?.content_b64 !== "string" || a.content_b64.length > 4_000_000)) return json(400, { ok: false, reason: "bad_attachment" });
  try {
    const ready = await canSendAsNodusx();
    const from = ready ? NODUSX_FROM : FALLBACK_FROM;
    const raw = buildMime({
      fromName: "NodusX, Nodus Partners", from, to, cc, replyTo: ready ? NODUSX_FROM : FALLBACK_FROM, subject, text,
      html: typeof b.html === "string" && b.html.length < 100_000 ? b.html : undefined, attachments: atts,
    });
    const sent = await gmail("/messages/send", { raw });
    return json(200, { ok: true, id: sent.id, from, kind: b.kind ?? null });
  } catch (e) {
    return json(502, { ok: false, reason: "send_failed", message: String(e).slice(0, 300) });
  }
});
