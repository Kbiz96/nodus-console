// Every read and write the console makes. Reads go to tables (protected by Row Level Security);
// writes go only through the checked database functions.
import { supabase, must } from "./supabase.ts";
import type { Filters } from "./filters.ts";
import { nextDay, ukDayStartIso } from "./format.ts";
import type { SearchAll } from "./types.ts";
import type { CrmDetails, EnrichResult } from "./enrich.ts";

export const MATCH_CARD_COLS =
  "id,status,total_score,scores,thesis,explanation,reject_reason,created_at,line,supply_id,supply_title,supply_gate,need_id,need_title,need_gate,mandate_id,mandate_label";

/** Calls search_all with the page's filters. Several words must all appear. */
export async function searchAll(f: Filters, limit = 50): Promise<SearchAll> {
  const res = await supabase.rpc("search_all", {
    q: f.q || "",
    p_line: f.line,
    p_country: f.country,
    p_from: f.from,
    p_to: f.to,
    p_min_mw: f.minMw,
    p_limit: limit,
  });
  const d = must(res) as Partial<SearchAll> | null;
  return {
    organisations: d?.organisations ?? [],
    opportunities: d?.opportunities ?? [],
    signals: d?.signals ?? [],
    matches: d?.matches ?? [],
    mandates: d?.mandates ?? [],
  };
}

/** Date filters as UTC instants for UK days: [from 00:00 UK, to+1 00:00 UK). */
export function dateRange(f: Filters): { gte: string | null; lt: string | null } {
  return { gte: f.from ? ukDayStartIso(f.from) : null, lt: f.to ? ukDayStartIso(nextDay(f.to)) : null };
}

// ---------- writes (database functions) ----------

export async function matchDecide(id: string, action: "shortlist" | "reject" | "reopen", reason?: string): Promise<void> {
  must(await supabase.rpc("match_decide", { p_match: id, p_action: action, p_reason: reason ?? null }));
}

export async function matchExport(id: string): Promise<unknown> {
  return must(await supabase.rpc("match_export", { p_match: id }));
}

export async function gateAdvance(id: string, reason: string, confirmed: boolean): Promise<string> {
  return must(await supabase.rpc("gate_advance", { p_opp: id, p_reason: reason, p_confirmed: confirmed })) as string;
}

export async function mandateSave(m: {
  id: string | null;
  label: string;
  line: string;
  side: string;
  criteria: Record<string, unknown>;
  capitalCircle: boolean;
  active: boolean;
}): Promise<string> {
  return must(
    await supabase.rpc("mandate_save", {
      p_id: m.id,
      p_label: m.label,
      p_line: m.line,
      p_side: m.side,
      p_criteria: m.criteria,
      p_capital_circle: m.capitalCircle,
      p_active: m.active,
    }),
  ) as string;
}

/** Ask for decision makers on one opportunity, or on both sides of a match. Refusals come back with a plain reason. */
export async function enrichRequest(target: { opp: string } | { match: string }): Promise<EnrichResult[]> {
  const args = "opp" in target ? { p_opp: target.opp, p_match: null } : { p_opp: null, p_match: target.match };
  const d = must(await supabase.rpc("enrich_request", args));
  return Array.isArray(d) ? (d as EnrichResult[]) : [];
}

/** Kuran's OK for one request to go over a credit cap (1–200 credits). */
export async function enrichApprove(id: string, credits: number): Promise<void> {
  must(await supabase.rpc("enrich_approve", { p_request: id, p_credits: credits }));
}

/** The "Add to CRM" button: returns the details to paste and marks the person as added. Never writes to the CRM. */
export async function personCrmMark(linkId: string): Promise<CrmDetails> {
  return must(await supabase.rpc("person_crm_mark", { p_link: linkId })) as CrmDetails;
}

/** Is the signed-in email on the approved list? (nodus_is_kuran is granted to signed-in users.) */
export async function isApproved(): Promise<boolean> {
  return Boolean(must(await supabase.rpc("nodus_is_kuran")));
}

/** Save a JSON value as a file in the browser's downloads. */
export function downloadJson(value: unknown, filename: string): void {
  downloadText(JSON.stringify(value, null, 2), filename, "application/json");
}

/** Copy text to the clipboard. Returns false if the browser would not allow it. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or the click was too long ago: fall back to a hidden text box.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Save text as a file in the browser's downloads. */
export function downloadText(text: string, filename: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
