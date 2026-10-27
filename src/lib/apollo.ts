// The console's calls to the nodus-apollo Edge Function (Supabase): Send a draft through Apollo, Find leads, Enrich one
// email. The function holds the Apollo key; the console never sees it. Pure helpers here are unit-tested.
import { supabase } from "./supabase.ts";

export const APOLLO_FN = "nodus-apollo";
export const SETUP_NOTE = "Add your Apollo API key in Supabase → Edge Functions → Secrets as APOLLO_API_KEY";

export interface ApolloSequence { key: string; id: string; name: string; from?: string }
export interface ApolloFail { ok: false; reason: string; message?: string; status?: number | string; sequence?: ApolloSequence; detail?: string; stage?: string; credits?: number }
export interface SendOk { ok: true; contact_id: string; sequence: ApolloSequence; note?: string; warning?: string; followups_missing?: string[] }
export interface FindPerson {
  apollo_id: string; name: string; title: string | null; company: string | null; domain: string | null; linkedin: string | null;
  country: string | null; has_email: boolean | null; size_evidence: string | null; why: string; known: boolean; lead_candidate_id: string | null;
}
export interface FindEngineRow {
  match_id: string; tier: string | null; score: number | string | null; pair_type: string | null; why: string | null; mandate_code: string | null;
  need_side: { name?: string | null; what?: string | null } | null; supply_side: { name?: string | null; what?: string | null } | null;
}
export interface FindOk {
  ok: true; mandate: { id: string; label: string } | null; engine: FindEngineRow[]; people: FindPerson[]; added: number;
  note: string | null; apollo_skipped?: string; message?: string; parsed?: Record<string, unknown>;
}
export interface EnrichOk { ok: true; email: string; email_status: string | null; contact_id: string; credits: number }

/** Calls the function. Transport and auth failures come back as ok:false with a reason, never as a thrown error. */
export async function callApollo<T>(body: Record<string, unknown>): Promise<T | ApolloFail> {
  try {
    const { data, error } = await supabase.functions.invoke(APOLLO_FN, { body });
    if (error) {
      let detail: { reason?: string; message?: string } | null = null;
      const ctx = (error as { context?: Response }).context;
      try { detail = ctx && typeof ctx.json === "function" ? await ctx.json() : null; } catch { detail = null; }
      return { ok: false, reason: detail?.reason ?? "unreachable", message: detail?.message ?? error.message };
    }
    return (data ?? { ok: false, reason: "empty" }) as T | ApolloFail;
  } catch (e) {
    return { ok: false, reason: "unreachable", message: e instanceof Error ? e.message : String(e) };
  }
}

export const apolloSend = (outreachId: string) => callApollo<SendOk>({ action: "send", outreach_id: outreachId });
export const apolloFind = (query: string, mandateId?: string | null) => callApollo<FindOk>({ action: "find", query, ...(mandateId ? { mandate_id: mandateId } : {}) });
export const apolloEnrich = (leadId: string) => callApollo<EnrichOk>({ action: "enrich", lead_candidate_id: leadId });

export function sequenceUrl(id: string): string {
  return `https://app.apollo.io/#/sequences/${id}`;
}

/** One plain-English line for a failed call; `link` is set when there is somewhere to go and fix it. */
export function apolloFailText(r: ApolloFail): { text: string; link?: { href: string; label: string } } {
  switch (r.reason) {
    case "missing_api_key": return { text: SETUP_NOTE };
    case "sequence_inactive": {
      const name = r.sequence?.name ?? "this";
      return { text: `Activate the ${name} sequence in Apollo first. Nothing was sent.`, link: r.sequence ? { href: sequenceUrl(r.sequence.id), label: "Open the sequence in Apollo" } : undefined };
    }
    case "do_not_contact": return { text: "Not sent: this person is marked do not contact." };
    case "contact_stage": return { text: `Not sent: they are already at ${r.stage ?? "a later stage"} in the CRM.` };
    case "wrong_status": return { text: `Not sent: this email is already ${String(r.status ?? "handled")}.` };
    case "no_email": return { text: r.message ?? "Not sent: no email address on this draft." };
    case "not_email": return { text: "Not sent: this is not an email." };
    case "apollo_auth": return { text: "Apollo refused the key. Check APOLLO_API_KEY in Supabase → Edge Functions → Secrets." };
    case "rate_limited": return { text: "Apollo is rate-limiting. Wait a minute and press Send again." };
    case "apollo_skipped": return { text: `Apollo did not add them to the sequence (${r.detail ?? "skipped"}). Nothing was marked sent.` };
    case "not_allowed": return { text: "This login is not allowed to send." };
    case "unreachable": return { text: `Could not reach the Apollo function (${r.message ?? "network"}). Nothing was sent.` };
    default: return { text: `Apollo: ${r.message ?? r.reason}.` };
  }
}

/** The Claude hand-off behind "Draft" on a Find result: one first touch into the Approve deck, follow-ups in the note. */
export function draftPrompt(p: Pick<FindPerson, "name" | "title" | "company" | "lead_candidate_id" | "size_evidence" | "why">, email: string | null, about: string): string {
  const who = [p.name, p.title, p.company].filter(Boolean).join(", ");
  return (
    `Nodus command: draft a first-touch email per OUTBOUND-PROMPT v3 to ${who}` +
    `${p.lead_candidate_id ? ` (lead_candidates id ${p.lead_candidate_id})` : ""}${email ? `, ${email}` : ""}, for: ${about}. ` +
    `Why them: ${p.why}${p.size_evidence ? `; size evidence: ${p.size_evidence}` : "; size not evidenced, check it first"}. ` +
    "Check the CRM and outreach history first. Capital: relationship-first with the mandate range and a light close; power and compute: direct; procurement: RFQ. " +
    "No names across sides before Protected; never mention fees. Save it to outreach as a draft (channel email, to_email set, linked contact) " +
    "so it appears in the console Approve deck, and put two short follow-ups in the note as \"FU1: ...\" and \"FU2: ...\". Do not send."
  );
}
