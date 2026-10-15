// Every read and write the console makes. Reads go to tables (protected by Row Level Security);
// writes go only through the checked database functions.
import { supabase, must } from "./supabase.ts";
import type { Filters } from "./filters.ts";
import { nextDay, ukDayStartIso } from "./format.ts";
import type { SearchAll } from "./types.ts";

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

/** Is the signed-in email on the approved list? (nodus_is_kuran is granted to signed-in users.) */
export async function isApproved(): Promise<boolean> {
  return Boolean(must(await supabase.rpc("nodus_is_kuran")));
}

/** Save a JSON value as a file in the browser's downloads. */
export function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
