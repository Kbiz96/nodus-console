import { useState } from "react";
import { apolloEnrich, apolloFailText, draftPrompt } from "../lib/apollo.ts";
import { claudeLink } from "../lib/claude.ts";
import type { Lead } from "../lib/leads.ts";
import { toast } from "./Toast.tsx";

/** Can this lead's email be revealed through Apollo (it came from an Apollo search, with Apollo's id)? */
export function canEnrich(r: Pick<Lead, "source" | "source_ref">): boolean {
  return Boolean(r.source_ref && String(r.source ?? "").toLowerCase().startsWith("apollo"));
}

/**
 * One button per lead: reveal the business email through Apollo (1 credit), then open the Claude draft hand-off with
 * the email filled in. The Claude tab opens on the click (so the browser allows it) and is pointed at the chat once
 * the email is back. Leads without an Apollo id go straight to the draft. Nothing is sent.
 */
export function LeadEnrichDraft({ r, about }: { r: Lead; about: string }) {
  const [busy, setBusy] = useState(false);
  const enrichable = canEnrich(r);
  const prompt = (email: string | null) =>
    claudeLink(draftPrompt({ name: r.name, title: r.title, company: r.company, lead_candidate_id: r.id, size_evidence: null, why: r.fit_reason || `${r.title ?? "Senior"} at ${r.company ?? "their firm"}` }, email, about)).url;

  const go = async () => {
    if (busy) return;
    const w = window.open("about:blank", "_blank");
    if (w) w.opener = null;
    if (!enrichable) {
      if (w) w.location.href = prompt(null);
      return;
    }
    setBusy(true);
    const res = await apolloEnrich(r.id);
    setBusy(false);
    if (!res.ok) {
      toast(`${apolloFailText(res).text}${res.reason === "no_email" ? " Drafting without an email." : ""}`, false);
      if (res.reason === "no_email" && w) w.location.href = prompt(null);
      else w?.close();
      return;
    }
    toast(`Email found: ${res.email}. Claude is drafting in the new tab.`);
    if (w) w.location.href = prompt(res.email);
  };

  return (
    <button type="button" className="btn small lead-enrich" disabled={busy} onClick={() => void go()} title={enrichable ? "Reveals the email (1 Apollo credit), then opens Claude to draft. Nothing is sent." : "Opens Claude to draft. Nothing is sent."}>
      {busy ? "Enriching…" : enrichable ? "Enrich & draft" : "Draft"}
    </button>
  );
}
