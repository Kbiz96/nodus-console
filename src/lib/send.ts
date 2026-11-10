// The console's Send button: one approved email out of Kuran's Gmail through the nodus-send Edge Function.
// Capital goes from kuran@nodus.partners, everything else from info@nodus.equipment (the function decides and checks).
// Apollo stays for finding and enriching people (see apollo.ts); it no longer sends.
import { supabase } from "./supabase.ts";

export const SEND_FN = "nodus-send";

export interface SendFail {
  ok: false; reason: string; message?: string; status?: number | string; from?: string; verified?: string[];
  domain?: string; prior_to?: string; prior_at?: string; cap?: number; sent_today?: number; stage?: string;
}
export interface SendOk {
  ok: true; from: string; lane: "capital" | "other"; via: "draft" | "row"; message_id: string; thread_id: string | null;
  sent_today: number; cap: number; warning?: string; already_sent?: boolean;
}
export interface SendStatus {
  ok: true; connected: boolean; verified?: string[]; missing?: string[]; cap: number; sent_today: number; message?: string; reason?: string;
  routing: { capital: string; other: string };
}

async function call<T>(body: Record<string, unknown>): Promise<T | SendFail> {
  try {
    const { data, error } = await supabase.functions.invoke(SEND_FN, { body });
    if (error) {
      let detail: { reason?: string; message?: string } | null = null;
      const ctx = (error as { context?: Response }).context;
      try { detail = ctx && typeof ctx.json === "function" ? await ctx.json() : null; } catch { detail = null; }
      return { ok: false, reason: detail?.reason ?? "unreachable", message: detail?.message ?? error.message };
    }
    return (data ?? { ok: false, reason: "empty" }) as T | SendFail;
  } catch (e) {
    return { ok: false, reason: "unreachable", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Sends one draft now. `force` sends a first touch even when that company already had an email (after Kuran confirms). */
export const gmailSend = (outreachId: string, force = false) => call<SendOk>({ action: "send", outreach_id: outreachId, ...(force ? { force: true } : {}) });
export const gmailStatus = () => call<SendStatus>({ action: "status" });

/** Problems that would stop every send in a batch, so "Send all" stops at the first one. */
export const STOP_ALL = ["gmail_not_connected", "gmail_auth", "alias_not_verified", "daily_cap", "unreachable", "not_allowed", "rate_limited"];

/** One plain-English line for a failed send. Nothing is ever marked sent when this shows. */
export function sendFailText(r: SendFail): { text: string; link?: { href: string; label: string } } {
  switch (r.reason) {
    case "gmail_not_connected": return { text: "Gmail is not connected yet, so nothing was sent. Add the three Gmail secrets in Supabase (see the setup note)." };
    case "gmail_auth": return { text: "Google refused the Gmail connection (the key may have been revoked). Reconnect Gmail. Nothing was sent." };
    case "alias_not_verified":
      return {
        text: `Not sent: ${r.from ?? "that address"} is not a verified "Send mail as" address in Gmail.`,
        link: { href: "https://mail.google.com/mail/u/0/#settings/accounts", label: "Open Gmail → Accounts" },
      };
    case "daily_cap": return { text: `Not sent: today's limit of ${r.cap ?? 50} emails is reached (${r.sent_today ?? r.cap} sent). It resets at midnight UK time.` };
    case "domain_contacted": return { text: `Held: ${r.domain ?? "this company"} already had an email${r.prior_to ? ` (${r.prior_to})` : ""}. One company at a time.` };
    case "do_not_contact": return { text: "Not sent: this person is marked do not contact." };
    case "contact_stage": return { text: `Not sent: they are already at ${r.stage ?? "a later stage"} in the CRM.` };
    case "wrong_status": return { text: `Not sent: this email is already ${String(r.status ?? "handled")}.` };
    case "no_email": return { text: r.message ?? "Not sent: no email address on this draft." };
    case "empty": return { text: r.message ?? "Not sent: the draft has no subject or body." };
    case "not_email": return { text: "Not sent: this is not an email." };
    case "rate_limited": return { text: "Gmail is rate-limiting. Wait a minute and press Send again." };
    case "not_allowed": return { text: "This login is not allowed to send." };
    case "unreachable": return { text: `Could not reach the send function (${r.message ?? "network"}). Nothing was sent.` };
    default: return { text: `Gmail: ${r.message ?? r.reason}. Check Sent in Gmail before trying again.` };
  }
}
