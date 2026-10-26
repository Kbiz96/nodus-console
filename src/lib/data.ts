// Every read and write the console makes. Reads go to tables (protected by Row Level Security);
// writes go only through the checked database functions.
import { supabase, must } from "./supabase.ts";
import type { Filters } from "./filters.ts";
import { nextDay, ukDayStartIso } from "./format.ts";
import type { Deal, NetworkRow, Priority, PriorityProgress, SearchAll } from "./types.ts";
import { ukToday } from "./crm.ts";
import { dismissalRows, type Dismissal } from "./mandates.ts";
import type { CrmDetails, EnrichResult } from "./enrich.ts";
import type { ScoreCounts } from "./scoreboard.ts";

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

/** Reject with a reason from the list (and an optional note); the engine learns from it. */
export async function matchReject(id: string, reason: string, note: string): Promise<void> {
  must(await supabase.rpc("match_reject", { p_match: id, p_reason: reason, p_note: note.trim() || null }));
}

/** Read-only counts for the weekly scoreboard, for one period [from, to). */
export async function scoreboard(from: string, to: string): Promise<ScoreCounts> {
  return (must(await supabase.rpc("scoreboard", { p_from: from, p_to: to })) as ScoreCounts | null) ?? {};
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

// ---------- CRM writes ----------
// Outreach decisions always go through the outreach_decide database function.

/** A direct update that changed no rows was refused (or the record is gone): say so rather than pretend. */
function mustChange(res: { data: unknown; error: { message: string; code?: string } | null }, what: string): void {
  const rows = must(res as { data: unknown[] | null; error: { message: string; code?: string } | null });
  if (!rows || rows.length === 0) throw new Error(`${what} was not saved. It may have changed or been removed; reload and try again.`);
}

export async function outreachDecide(id: string, decision: "approve" | "skip" | "edit", subject?: string | null, body?: string | null): Promise<void> {
  must(await supabase.rpc("outreach_decide", { p_id: id, p_decision: decision, p_subject: subject ?? null, p_body: body ?? null }));
}

/** Kuran has sent a LinkedIn item himself. The one direct status update the console makes. */
/** Bring a parked draft back into the review deck (status parked -> draft). RLS allows Kuran's login. */
export async function outreachUnpark(id: string): Promise<void> {
  mustChange(await supabase.from("outreach").update({ status: "draft" }).eq("id", id).eq("status", "parked").select("id"), "This draft");
}

export async function outreachMarkSent(id: string): Promise<void> {
  mustChange(await supabase.from("outreach").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", id).eq("status", "manual").select("id"), "This message");
}

export async function actionSetStatus(id: string, status: "open" | "done" | "dismissed"): Promise<void> {
  mustChange(await supabase.from("crm_actions").update({ status, updated_at: new Date().toISOString() }).eq("id", id).select("id"), "This action");
}

export async function contactUpdate(id: string, patch: Record<string, unknown>): Promise<void> {
  mustChange(await supabase.from("crm_contacts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("id"), "The contact");
}

export async function dealUpdate(id: string, patch: Record<string, unknown>): Promise<void> {
  mustChange(await supabase.from("deals").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("id"), "The deal");
}

export async function mandateCardUpdate(
  id: string,
  patch: { kind: string | null; holder: string | null; confidence: string | null; to_ask: string | null; card: Record<string, unknown> },
): Promise<void> {
  mustChange(await supabase.from("mandates").update(patch).eq("id", id).select("id"), "The mandate card");
}

/** One-off import of the old HQ export. The file is sent only to this database function. */
export async function crmImport(p: unknown): Promise<Record<string, unknown>> {
  return (must(await supabase.rpc("crm_import", { p })) ?? {}) as Record<string, unknown>;
}

// ---------- priorities (Focus) ----------
// Kuran's short list of what to close. RLS lets his login read and write the table directly.

export const PRIORITY_COLS = "id,rank,title,goal,who,next_action,line,mandate_ids,deal_ids,status,notes,created_at,updated_at,target_lines,keywords,region_pattern";

export async function prioritiesLoad(): Promise<{ priorities: Priority[]; progress: Map<string, PriorityProgress> }> {
  const [ps, pr] = await Promise.all([
    supabase.from("priorities").select(PRIORITY_COLS).order("rank", { ascending: true }).limit(200).then((r) => must(r) as unknown as Priority[]),
    supabase.from("priority_progress").select("priority_id,drafts,approved,sent,replied,manual,last_sent_at").limit(500)
      .then((r) => must(r) as unknown as PriorityProgress[]),
  ]);
  const progress = new Map<string, PriorityProgress>();
  for (const p of pr) {
    progress.set(p.priority_id, {
      ...p,
      drafts: Number(p.drafts) || 0,
      approved: Number(p.approved) || 0,
      sent: Number(p.sent) || 0,
      replied: Number(p.replied) || 0,
      manual: Number(p.manual) || 0,
    });
  }
  return { priorities: [...ps].sort((a, b) => a.rank - b.rank), progress };
}

export const SIGNED_DEAL_COLS = "id,deal,stage,heat,ncnda_signed,fee_signed,principal_verified,next_step,next_date";

/** The deals linked to priorities, for the signed badge and the deal's next step on Focus. */
export async function priorityDeals(ids: string[]): Promise<Map<string, Deal>> {
  const uniq = [...new Set(ids)].filter(Boolean);
  if (uniq.length === 0) return new Map();
  const rows = must(await supabase.from("deals").select(SIGNED_DEAL_COLS).in("id", uniq.slice(0, 100))) as unknown as Deal[];
  return new Map(rows.map((d) => [d.id, d]));
}

/** The best people already in the CRM for one priority, with plain-English reasons (priority_network). */
export async function priorityNetwork(id: string, limit = 15): Promise<NetworkRow[]> {
  const d = must(await supabase.rpc("priority_network", { p_priority: id, p_limit: limit }));
  return Array.isArray(d) ? (d as NetworkRow[]) : [];
}

/**
 * "Not now" people still in force for these priorities (no end date, or an end date of today or later).
 * If the table cannot be read (for example before it exists), the list simply shows everyone.
 */
export async function networkDismissals(priorityIds: string[], today = ukToday()): Promise<Dismissal[]> {
  if (priorityIds.length === 0) return [];
  const res = await supabase
    .from("network_dismissals")
    .select("id,priority_id,contact_id,reason,until,created_at")
    .in("priority_id", priorityIds)
    .or(`until.is.null,until.gte.${today}`)
    .order("created_at", { ascending: false })
    .limit(500);
  if (res.error) {
    console.warn("network_dismissals not readable:", res.error.message);
    return [];
  }
  return (res.data ?? []) as Dismissal[];
}

/** Hide people from one priority's network list (60 days by default). Saying it again just updates the row. */
export async function networkDismiss(priorityId: string, contactIds: string[], reason: string | null = null): Promise<void> {
  const rows = dismissalRows(priorityId, contactIds, reason);
  if (rows.length === 0) return;
  must(await supabase.from("network_dismissals").upsert(rows, { onConflict: "priority_id,contact_id" }).select("id"));
}

/** Bring people back (Undo, or "Bring back" under Dismissed). */
export async function networkUndismiss(priorityId: string, contactIds: string[]): Promise<void> {
  if (contactIds.length === 0) return;
  must(await supabase.from("network_dismissals").delete().eq("priority_id", priorityId).in("contact_id", contactIds).select("id"));
}

/** Names for the Dismissed list, straight from the CRM. */
export async function contactNames(ids: string[]): Promise<Map<string, { name: string | null; title: string | null; company: string | null }>> {
  if (ids.length === 0) return new Map();
  const rows = must(await supabase.from("crm_contacts").select("id,name,title,company").in("id", ids)) as { id: string; name: string | null; title: string | null; company: string | null }[] | null;
  return new Map((rows ?? []).map((r) => [r.id, r]));
}

export type PriorityPatch = Partial<Pick<Priority, "rank" | "title" | "goal" | "who" | "next_action" | "line" | "status" | "notes">>;

export async function priorityUpdate(id: string, patch: PriorityPatch): Promise<void> {
  mustChange(await supabase.from("priorities").update(patch).eq("id", id).select("id"), "The priority");
}

export async function priorityInsert(p: { title: string; goal: string | null; who: string | null; next_action: string | null; rank: number }): Promise<void> {
  const rows = must(await supabase.from("priorities").insert({ ...p, status: "active" }).select("id")) as unknown[] | null;
  if (!rows || rows.length === 0) throw new Error("The priority was not added. Reload and try again.");
}

/** Swap the ranks of two priorities (move up or down). */
export async function prioritySwap(a: Pick<Priority, "id" | "rank">, b: Pick<Priority, "id" | "rank">): Promise<void> {
  const ra = a.rank === b.rank ? b.rank + 1 : b.rank;
  await priorityUpdate(a.id, { rank: ra });
  await priorityUpdate(b.id, { rank: a.rank });
}

/**
 * Copy text straight away, inside the click, so it still works when the same click opens a new tab
 * (the new tab takes focus, which makes the asynchronous clipboard refuse). Falls back to the clipboard API.
 */
export function copyNow(text: string): boolean {
  let ok = false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    ok = document.execCommand("copy");
    ta.remove();
  } catch {
    ok = false;
  }
  if (!ok) {
    try {
      void navigator.clipboard?.writeText(text).catch(() => undefined);
      ok = Boolean(navigator.clipboard);
    } catch {
      ok = false;
    }
  }
  return ok;
}

/** Tell the nav that outreach changed, so the drafts badge refreshes. */
export function outreachChanged(): void {
  window.dispatchEvent(new Event("nodus-outreach-changed"));
}
