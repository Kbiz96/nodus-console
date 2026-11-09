// nodus-send: the console's Send button. Sends one approved email from Kuran's Gmail (the info@nodus.equipment
// Google Workspace mailbox) through the Gmail API, from the right address:
//   capital                → kuran@nodus.partners (a verified "Send mail as" alias on that mailbox)
//   everything else        → info@nodus.equipment
// Actions:
//   send   {outreach_id, from?, force?}  If the row has a Gmail draft, that draft is sent (so edits made in Gmail count),
//                                        with its From set to the right address. Otherwise a message is built from the
//                                        row, in its Gmail thread when there is one. Marks the row sent.
//   status {}                            Is Gmail connected, which aliases are verified, sent today against the cap.
// Checks before every send: draft/approved email with an address; not do-not-contact or already in conversation;
// one company at a time for first touches (no other email sent to that domain in 90 days unless force);
// the daily cap (SEND_DAILY_CAP, default 50, counted from UK midnight); the From alias is verified in Gmail.
// Auth: the gateway verifies the JWT; this function then checks the console allow-list (nodus_is_kuran) and does every
// read and write as that user, under row-level security. Gmail credentials come from the secrets GMAIL_CLIENT_ID,
// GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN (scopes gmail.modify and gmail.settings.basic). Never logged or returned.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  ALLOWED_FROM, FROM_CAPITAL, FROM_DEFAULT, GENERIC_DOMAINS, addressIn, buildMessage, domainOf, fromFor, pickLane, rewriteFrom,
  ukMidnightIso,
} from "./mail.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const SETUP = "Connect Gmail: add GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN in Supabase → Edge Functions → Secrets.";
const BLOCKED_STAGES = ["replied", "meeting", "declined", "opted out", "bounced"];
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
const fail = (reason: string, extra: Record<string, unknown> = {}) => json(200, { ok: false, reason, ...extra });

class GmailError extends Error {
  constructor(public reason: string, public status: number, message: string) { super(message); }
}

// ---------- Gmail ----------

let token: { value: string; until: number } | null = null;
async function accessToken(): Promise<string> {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GMAIL_CLIENT_ID")!, client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GMAIL_REFRESH_TOKEN")!, grant_type: "refresh_token",
    }),
  });
  const d = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !d.access_token) throw new GmailError("gmail_auth", res.status, d.error_description ?? d.error ?? "token refused");
  token = { value: d.access_token, until: Date.now() + (d.expires_in ?? 3000) * 1000 };
  return token.value;
}

async function gmail(path: string, opts: { method?: string; body?: unknown } = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${GMAIL}${path}`, {
    method: opts.method ?? "GET",
    headers: { Authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const msg = String(((data.error as { message?: string } | undefined)?.message) ?? text).slice(0, 300);
    const reason = res.status === 401 || res.status === 403 ? "gmail_auth" : res.status === 404 ? "gmail_not_found" : res.status === 429 ? "rate_limited" : "gmail_error";
    throw new GmailError(reason, res.status, msg);
  }
  return data;
}

let aliases: { list: string[]; at: number } | null = null;
/** Addresses this mailbox may send as (verified only), cached for 10 minutes per worker. */
async function verifiedFrom(): Promise<string[]> {
  if (aliases && aliases.at > Date.now() - 600_000) return aliases.list;
  const d = await gmail("/settings/sendAs");
  const list = ((d.sendAs ?? []) as { sendAsEmail: string; isPrimary?: boolean; verificationStatus?: string }[])
    .filter((a) => a.isPrimary || a.verificationStatus === "accepted")
    .map((a) => a.sendAsEmail.toLowerCase());
  aliases = { list, at: Date.now() };
  return list;
}

const connected = () => Boolean(Deno.env.get("GMAIL_CLIENT_ID") && Deno.env.get("GMAIL_CLIENT_SECRET") && Deno.env.get("GMAIL_REFRESH_TOKEN"));
const dailyCap = () => Math.max(1, Number(Deno.env.get("SEND_DAILY_CAP") ?? "50") || 50);

async function sentToday(db: SupabaseClient): Promise<number> {
  const { count } = await db.from("outreach").select("id", { count: "exact", head: true })
    .eq("channel", "email").eq("status", "sent").gte("sent_at", ukMidnightIso());
  return count ?? 0;
}

// ---------- send ----------

type Row = {
  id: string; status: string; channel: string; to_email: string | null; to_name: string | null; company: string | null;
  subject: string | null; body: string | null; note: string | null; contact_id: string | null; priority_id: string | null;
  kind: string | null; approved_at: string | null; gmail_draft_id: string | null; thread_id: string | null; sequence_step: number | null;
};

async function send(db: SupabaseClient, b: { outreach_id?: string; from?: string; force?: boolean }) {
  if (!b.outreach_id) return fail("bad_request", { message: "outreach_id is required" });
  const { data: o, error } = await db.from("outreach")
    .select("id,status,channel,to_email,to_name,company,subject,body,note,contact_id,priority_id,kind,approved_at,gmail_draft_id,thread_id,sequence_step")
    .eq("id", b.outreach_id).maybeSingle<Row>();
  if (error) return fail("db_error", { message: error.message });
  if (!o) return fail("not_found");
  if (!["draft", "approved"].includes(o.status)) return fail("wrong_status", { status: o.status });
  if (o.channel !== "email") return fail("not_email");
  const to = (o.to_email ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return fail("no_email", { message: "Not sent: no valid email address on this draft." });

  const cq = db.from("crm_contacts").select("id,do_not_contact,stage");
  const { data: cs } = o.contact_id ? await cq.eq("id", o.contact_id).limit(1) : await cq.ilike("email", to).limit(1);
  const contact = (cs?.[0] ?? null) as { do_not_contact: boolean; stage: string | null } | null;
  if (contact?.do_not_contact) return fail("do_not_contact");
  if (contact && BLOCKED_STAGES.includes((contact.stage ?? "").toLowerCase())) return fail("contact_stage", { stage: contact.stage });

  // One company at a time: a first touch is refused when that domain already had an email in the last 90 days.
  const firstTouch = (o.sequence_step ?? 1) <= 1;
  const domain = domainOf(to);
  if (firstTouch && domain && !GENERIC_DOMAINS.has(domain) && !b.force) {
    const since = new Date(Date.now() - 90 * 86400_000).toISOString();
    const { data: prior } = await db.from("outreach").select("id,to_email,sent_at")
      .eq("channel", "email").eq("status", "sent").ilike("to_email", `%@${domain}`).gte("sent_at", since).neq("id", o.id).limit(1);
    if (prior?.length) return fail("domain_contacted", { domain, prior_to: prior[0].to_email, prior_at: prior[0].sent_at });
  }

  const cap = dailyCap();
  const today = await sentToday(db);
  if (today >= cap) return fail("daily_cap", { cap, sent_today: today });

  let line: string | null = null;
  if (o.priority_id) {
    const { data: p } = await db.from("priorities").select("line").eq("id", o.priority_id).maybeSingle();
    line = (p?.line as string | null) ?? null;
  }
  const lane = pickLane(`${o.subject ?? ""} ${o.note ?? ""} ${o.body ?? ""}`, line);
  const from = b.from && ALLOWED_FROM.includes(b.from.toLowerCase()) ? b.from.toLowerCase() : fromFor(lane);
  const okFrom = await verifiedFrom();
  if (!okFrom.includes(from)) return fail("alias_not_verified", { from, verified: okFrom });

  // Send the Gmail draft when there is one (Kuran's edits in Gmail count), else build it from the row.
  let sent: { id?: string; threadId?: string } | null = null;
  let via = "row";
  if (o.gmail_draft_id) {
    try {
      const d = await gmail(`/drafts/${encodeURIComponent(o.gmail_draft_id)}?format=raw`);
      const msg = d.message as { raw?: string; threadId?: string } | undefined;
      if (msg?.raw) {
        const raw = rewriteFrom(msg.raw, from);
        await gmail(`/drafts/${encodeURIComponent(o.gmail_draft_id)}`, { method: "PUT", body: { id: o.gmail_draft_id, message: { raw, threadId: msg.threadId } } });
        sent = await gmail("/drafts/send", { method: "POST", body: { id: o.gmail_draft_id } }) as { id?: string; threadId?: string };
        via = "draft";
      }
    } catch (e) {
      if (!(e instanceof GmailError && e.reason === "gmail_not_found")) throw e; // draft gone: fall back to the row
    }
  }
  if (!sent) {
    if (!o.subject?.trim() || !o.body?.trim()) return fail("empty", { message: "Not sent: the draft has no subject or body." });
    let inReplyTo: string | null = null, references: string | null = null, threadId: string | undefined;
    let subject = o.subject.trim();
    if (o.thread_id && !firstTouch) {
      try {
        const t = await gmail(`/threads/${encodeURIComponent(o.thread_id)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject`);
        const msgs = (t.messages ?? []) as { payload?: { headers?: { name: string; value: string }[] } }[];
        const last = msgs[msgs.length - 1]?.payload?.headers ?? [];
        const h = (n: string) => last.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? null;
        inReplyTo = h("Message-ID");
        references = [h("References"), inReplyTo].filter(Boolean).join(" ") || null;
        const first = msgs[0]?.payload?.headers?.find((x) => x.name.toLowerCase() === "subject")?.value;
        if (first) subject = /^re:/i.test(first) ? first : `Re: ${first}`;
        threadId = o.thread_id;
      } catch (e) {
        if (!(e instanceof GmailError && e.reason === "gmail_not_found")) throw e;
      }
    }
    const raw = buildMessage({ from, to, toName: o.to_name, subject, body: o.body, inReplyTo, references });
    sent = await gmail("/messages/send", { method: "POST", body: threadId ? { raw, threadId } : { raw } }) as { id?: string; threadId?: string };
  }
  if (!sent?.id) return fail("gmail_error", { message: "Gmail did not return a message id. Check Sent in Gmail before pressing Send again." });

  // What Gmail actually put on the From line (it rewrites an unverified alias to the primary address).
  let actualFrom = from;
  let warning: string | undefined;
  try {
    const m = await gmail(`/messages/${sent.id}?format=metadata&metadataHeaders=From`);
    const hs = ((m.payload as { headers?: { name: string; value: string }[] } | undefined)?.headers ?? []);
    actualFrom = addressIn(hs.find((x) => x.name.toLowerCase() === "from")?.value) ?? from;
    if (actualFrom !== from) warning = `Gmail sent it from ${actualFrom}, not ${from}. Check the alias in Gmail settings.`;
  } catch { /* the send itself succeeded */ }

  const now = new Date().toISOString();
  const tag = `| gmail:${sent.id} | from:${actualFrom}`;
  const { data: upd, error: ue } = await db.from("outreach")
    .update({ status: "sent", approved_at: o.approved_at ?? now, sent_at: now, thread_id: sent.threadId ?? o.thread_id, note: `${o.note ?? ""}${o.note ? " " : ""}${tag}` })
    .eq("id", o.id).in("status", ["draft", "approved"]).select("id");
  if (ue || !upd?.length) warning = `${warning ? `${warning} ` : ""}Sent, but the outreach row was not updated; reload and check.`;
  return json(200, { ok: true, from: actualFrom, lane, via, message_id: sent.id, thread_id: sent.threadId ?? null, sent_today: today + 1, cap, warning });
}

async function status(db: SupabaseClient) {
  const base = { cap: dailyCap(), sent_today: await sentToday(db), routing: { capital: FROM_CAPITAL, other: FROM_DEFAULT } };
  if (!connected()) return json(200, { ok: true, connected: false, message: SETUP, ...base });
  try {
    const verified = await verifiedFrom();
    return json(200, { ok: true, connected: true, verified, missing: [FROM_CAPITAL, FROM_DEFAULT].filter((a) => !verified.includes(a)), ...base });
  } catch (e) {
    return json(200, { ok: true, connected: false, reason: e instanceof GmailError ? e.reason : "error", message: e instanceof Error ? e.message.slice(0, 200) : "", ...base });
  }
}

// ---------- entry ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { ok: false, reason: "method_not_allowed" });
  const auth = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/.test(auth)) return json(401, { ok: false, reason: "unauthorised" });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: u, error: ue } = await db.auth.getUser(auth.replace(/^Bearer\s+/, ""));
  if (ue || !u?.user?.email) return json(401, { ok: false, reason: "unauthorised" });
  const { data: allowed, error: ae } = await db.rpc("nodus_is_kuran");
  if (ae || allowed !== true) return json(403, { ok: false, reason: "not_allowed" });

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return fail("bad_request", { message: "JSON body expected" }); }
  try {
    if (b.action === "status") return await status(db);
    if (b.action === "send") {
      if (!connected()) return fail("gmail_not_connected", { message: SETUP });
      return await send(db, { outreach_id: b.outreach_id as string | undefined, from: b.from as string | undefined, force: b.force === true });
    }
    return fail("unknown_action");
  } catch (e) {
    if (e instanceof GmailError) return fail(e.reason, { status: e.status, message: e.message });
    return fail("error", { message: e instanceof Error ? e.message.slice(0, 300) : "unexpected error" });
  }
});
