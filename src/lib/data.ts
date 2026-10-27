// Every read and write the console makes. Reads go to tables (protected by Row Level Security);
// writes go only through the checked database functions.
import { supabase, must, DbError } from "./supabase.ts";
import { holdNote, OLD_STYLE_NOTE, type HoldKey } from "./deck.ts";
import type { Filters } from "./filters.ts";
import { nextDay, ukDayStartIso } from "./format.ts";
import type { BoardRow, CrmContact, MatchCardRow, Deal, NetworkRow, Outreach, Priority, PriorityProgress, SearchAll } from "./types.ts";
import { appendNote, ukToday } from "./crm.ts";
import { dismissalRows, type Dismissal } from "./mandates.ts";
import type { CrmDetails, EnrichResult } from "./enrich.ts";
import type { ScoreCounts } from "./scoreboard.ts";
import { LEAD_COLS, decisionPatch, type Lead, type LeadStatus } from "./leads.ts";
import { lastSentIn, sendWindowStart } from "./today.ts";
import { cached, invalidate } from "./cache.ts";
import { briefIsEmpty, parseBrief, type Brief, type LiveCounts, type PipelineCounts } from "./brief.ts";

export const MATCH_CARD_COLS =
  "id,status,total_score,scores,thesis,explanation,reject_reason,created_at,line,supply_id,supply_title,supply_gate,need_id,need_title,need_gate,mandate_id,mandate_label";

/** What the engine's graph and list draw: no explanation blob (fetched only for the match that is opened). */
export const MATCH_LIST_COLS =
  "id,status,total_score,scores,thesis,reject_reason,created_at,line,supply_id,supply_title,supply_gate,need_id,need_title,need_gate,mandate_id,mandate_label";
/** Engine views never draw more than this many matches. */
export const ENGINE_CAP = 200;

/** A match's explanation, loaded when Kuran opens it. */
export async function matchExplanation(id: string): Promise<MatchCardRow["explanation"]> {
  const r = must(await supabase.from("v_match_cards").select("explanation").eq("id", id).maybeSingle()) as { explanation: MatchCardRow["explanation"] } | null;
  return r?.explanation ?? null;
}

/** Mandates that are switched off (mandates.active = false). Their matches are hidden everywhere. */
export async function inactiveMandateIds(): Promise<string[]> {
  return cached("mandates:inactive", async () =>
    (must(await supabase.from("mandates").select("id").eq("active", false).limit(1000)) as { id: string }[]).map((m) => m.id));
}

/** Mandates that are switched on (cached ten minutes): engine views draw only matches on these. */
export async function activeMandateIds(): Promise<string[]> {
  return cached("mandates:active", async () =>
    (must(await supabase.from("mandates").select("id").eq("active", true).limit(1000)) as { id: string }[]).map((m) => m.id));
}

/** A PostgREST `or` filter keeping matches with no mandate or an active one; null when nothing is switched off. */
export function activeMandateFilter(inactive: string[]): string | null {
  return inactive.length ? `mandate_id.is.null,mandate_id.not.in.(${inactive.join(",")})` : null;
}

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
  invalidate("board");
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
  invalidate("mandates");
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
  invalidate("mandates");
  mustChange(await supabase.from("mandates").update(patch).eq("id", id).select("id"), "The mandate card");
}

/** One-off import of the old HQ export. The file is sent only to this database function. */
export async function crmImport(p: unknown): Promise<Record<string, unknown>> {
  return (must(await supabase.rpc("crm_import", { p })) ?? {}) as Record<string, unknown>;
}

// ---------- priorities (Focus) ----------
// Kuran's short list of what to close. RLS lets his login read and write the table directly.

export const PRIORITY_COLS = "id,rank,title,goal,who,next_action,line,mandate_ids,deal_ids,status,notes,created_at,updated_at,target_lines,keywords,region_pattern";

export interface PrioritiesRaw { ps: Priority[]; pr: PriorityProgress[] }

/** The rows behind priorities (JSON-safe, so they can be cached). */
export async function prioritiesRaw(): Promise<PrioritiesRaw> {
  const [ps, pr] = await Promise.all([
    supabase.from("priorities").select(PRIORITY_COLS).order("rank", { ascending: true }).limit(200).then((r) => must(r) as unknown as Priority[]),
    supabase.from("priority_progress").select("priority_id,drafts,approved,sent,replied,manual,last_sent_at").limit(500)
      .then((r) => must(r) as unknown as PriorityProgress[]),
  ]);
  return { ps, pr };
}

export function buildPriorities({ ps, pr }: PrioritiesRaw): { priorities: Priority[]; progress: Map<string, PriorityProgress> } {
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

export async function prioritiesLoad(): Promise<{ priorities: Priority[]; progress: Map<string, PriorityProgress> }> {
  return buildPriorities(await prioritiesRaw());
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

/**
 * New and approved leads (lead_candidates) for these priorities. If the table cannot be read, the queue is empty
 * rather than breaking the card.
 */
export async function leadsLoad(priorityIds: string[]): Promise<Lead[]> {
  const ids = [...new Set(priorityIds)].filter(Boolean);
  if (ids.length === 0) return [];
  const res = await supabase
    .from("lead_candidates")
    .select(LEAD_COLS)
    .in("priority_id", ids)
    .in("status", ["new", "approved"])
    .order("fit_score", { ascending: false, nullsFirst: false })
    .limit(500);
  if (res.error) {
    console.warn("lead_candidates not readable:", res.error.message);
    return [];
  }
  return (res.data ?? []) as unknown as Lead[];
}

// ---------- the front page: brief, live counts, Background BD ----------

/** Today's brief (UK date), or null when it is not in yet or cannot be read. */
export async function briefLoad(day = ukToday()): Promise<Brief | null> {
  const res = await supabase.from("daily_briefs").select("day,body,created_at").eq("day", day).limit(1);
  if (res.error) {
    console.warn("daily_briefs not readable:", res.error.message);
    return null;
  }
  const row = (res.data ?? [])[0] as { day: string; body: unknown } | undefined;
  if (!row) return null;
  const b = parseBrief(row.body, row.day);
  return briefIsEmpty(b) ? null : b;
}

/** A head-only count; null when the table or view cannot be read. */
async function countOf(build: () => PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number | null> {
  try {
    const res = await build();
    if (res.error) return null;
    return res.count ?? 0;
  } catch {
    return null;
  }
}

/** Email drafts waiting for approval: exactly what the Approve deck on Today shows (LinkedIn has its own panel). */
export function emailDraftCount(): Promise<number | null> {
  return countOf(() => supabase.from("outreach").select("id", { count: "exact", head: true }).eq("status", "draft").eq("channel", "email"));
}

/** When the last email actually went out within the last weekday day (null when none did, or when unreadable). */
export async function lastSentLoad(now = new Date()): Promise<string | null> {
  const res = await supabase
    .from("outreach")
    .select("sent_at")
    .eq("status", "sent")
    .eq("channel", "email")
    .gte("sent_at", sendWindowStart(now).toISOString())
    .order("sent_at", { ascending: false })
    .limit(20);
  if (res.error) return null;
  return lastSentIn(((res.data ?? []) as { sent_at: string | null }[]).map((r) => r.sent_at), now);
}

/** The counts behind the live Do now items. Anything unreadable counts as zero, so the page still renders. */
export async function liveCountsLoad(): Promise<LiveCounts> {
  const head = { count: "exact" as const, head: true };
  const [mandateLeads, backgroundLeads, drafts, replies, lastSentAt] = await Promise.all([
    countOf(() => supabase.from("lead_candidates").select("id", head).eq("status", "new").not("priority_id", "is", null)),
    countOf(() => supabase.from("lead_candidates").select("id", head).eq("status", "new").is("priority_id", null)),
    emailDraftCount(),
    countOf(() => supabase.from("outreach").select("id", head).eq("status", "replied")),
    lastSentLoad().catch(() => null),
  ]);
  return { mandateLeads: mandateLeads ?? 0, backgroundLeads: backgroundLeads ?? 0, drafts: drafts ?? 0, replies: replies ?? 0, lastSentAt };
}

/** bd_queue by tier: A is routed to a signed mandate, B is the background queue. */
export async function bdCountsLoad(): Promise<PipelineCounts> {
  const head = { count: "exact" as const, head: true };
  const [routed, background] = await Promise.all([
    countOf(() => supabase.from("bd_queue").select("opportunity_id", head).eq("tier", "A")),
    countOf(() => supabase.from("bd_queue").select("opportunity_id", head).eq("tier", "B")),
  ]);
  return { routed, background };
}

/** Background BD leads (no priority), new and approved, with each opportunity's line for the chip. */
export async function bdLeadsLoad(): Promise<Lead[]> {
  const res = await supabase
    .from("lead_candidates")
    .select(LEAD_COLS)
    .is("priority_id", null)
    .in("status", ["new", "approved"])
    .order("fit_score", { ascending: false, nullsFirst: false })
    .limit(300);
  if (res.error) {
    console.warn("background leads not readable:", res.error.message);
    return [];
  }
  const rows = (res.data ?? []) as unknown as Lead[];
  const opp = [...new Set(rows.map((r) => r.opportunity_id).filter(Boolean))] as string[];
  if (opp.length === 0) return rows;
  const lines = new Map<string, string>();
  for (let i = 0; i < opp.length; i += 150) {
    const o = await supabase.from("opportunities").select("id,line").in("id", opp.slice(i, i + 150));
    if (o.error) break;
    for (const x of (o.data ?? []) as { id: string; line: string | null }[]) if (x.line) lines.set(x.id, x.line);
  }
  return rows.map((r) => ({ ...r, line: r.opportunity_id ? lines.get(r.opportunity_id) ?? null : null }));
}

/** Approve, dismiss, or put back to new (Undo). */
export async function leadsDecide(ids: string[], status: LeadStatus): Promise<void> {
  if (ids.length === 0) return;
  must(await supabase.from("lead_candidates").update(decisionPatch(status)).in("id", ids).select("id"));
}

/** Names for the Dismissed list, straight from the CRM. */
export async function contactNames(ids: string[]): Promise<Map<string, { name: string | null; title: string | null; company: string | null }>> {
  if (ids.length === 0) return new Map();
  const rows = must(await supabase.from("crm_contacts").select("id,name,title,company").in("id", ids)) as { id: string; name: string | null; title: string | null; company: string | null }[] | null;
  return new Map((rows ?? []).map((r) => [r.id, r]));
}

export type PriorityPatch = Partial<Pick<Priority, "rank" | "title" | "goal" | "who" | "next_action" | "line" | "status" | "notes">>;

export async function priorityUpdate(id: string, patch: PriorityPatch): Promise<void> {
  invalidate("priorities");
  mustChange(await supabase.from("priorities").update(patch).eq("id", id).select("id"), "The priority");
}

export async function priorityInsert(p: { title: string; goal: string | null; who: string | null; next_action: string | null; rank: number }): Promise<void> {
  invalidate("priorities");
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

// ---------- Today: LinkedIn panel ----------

const LI_COLS =
  "id,kind,channel,contact_id,to_name,to_email,company,subject,body,link,sequence_step,status,note,origin,created_at,approved_at,sent_at,replied_at,priority_id";

export interface LiContact { id: string; name: string | null; linkedin: string | null; notes: string | null }

/** LinkedIn messages waiting for Kuran (draft or approved, never parked), with the notes of the people they go to. */
export async function linkedinLoad(): Promise<{ rows: Outreach[]; contacts: Map<string, LiContact> }> {
  const rows = (must(
    await supabase.from("outreach").select(LI_COLS).in("status", ["draft", "manual"]).or("channel.eq.linkedin,kind.in.(dm,connect)").order("created_at", { ascending: true }).limit(300),
  ) as unknown as Outreach[]).filter((r) => r.status !== "parked");
  const ids = [...new Set(rows.map((r) => r.contact_id).filter(Boolean))] as string[];
  const contacts = new Map<string, LiContact>();
  if (ids.length) {
    const cs = must(await supabase.from("crm_contacts").select("id,name,linkedin,notes").in("id", ids.slice(0, 300))) as unknown as LiContact[];
    for (const c of cs) contacts.set(c.id, c);
  }
  return { rows, contacts };
}

/** Kuran sent a connection request himself: noted on the contact so the next brief knows. */
export async function linkedinRequestSent(contactId: string, existing: string | null): Promise<void> {
  await contactUpdate(contactId, { notes: appendNote(existing, "LinkedIn connection request sent") });
}

// ---------- Pipeline ----------

const PIPE_DEAL_COLS = "id,deal,counterparty,stage,next_step,next_date,contact_id,heat,rank";
const PIPE_CONTACT_COLS = "id,name,company,stage,next_follow_up,email,last_activity";

export type PipeDeal = Pick<Deal, "id" | "deal" | "counterparty" | "stage" | "next_step" | "next_date" | "contact_id" | "heat" | "rank">;
export type PipeContact = Pick<CrmContact, "id" | "name" | "company" | "stage" | "next_follow_up" | "email" | "last_activity">;

/** Open deals, warm contacts (Replied, Meeting, Qualified, NCNDA) and the people behind the deals. */
export async function pipelineLoad(): Promise<{ deals: PipeDeal[]; contacts: PipeContact[]; people: PipeContact[] }> {
  const [d, c] = await Promise.all([
    // Closed deals are left out in pipelineRows (a stage filter here would also drop deals with no stage).
    supabase.from("deals").select(PIPE_DEAL_COLS).limit(1000),
    supabase.from("crm_contacts").select(PIPE_CONTACT_COLS).in("stage", ["Replied", "Meeting", "Qualified", "NCNDA"]).limit(1000),
  ]);
  const deals = must(d) as unknown as PipeDeal[];
  const contacts = must(c) as unknown as PipeContact[];
  const have = new Set(contacts.map((x) => x.id));
  const missing = [...new Set(deals.map((x) => x.contact_id).filter((id): id is string => Boolean(id) && !have.has(id as string)))];
  // People behind a deal give it a name and an email; they are not rows of their own unless they are warm.
  const people = missing.length ? (must(await supabase.from("crm_contacts").select(PIPE_CONTACT_COLS).in("id", missing.slice(0, 300))) as unknown as PipeContact[]) : [];
  return { deals, contacts, people };
}

// ---------- the match board (Engine → Board) ----------

export const BOARD_COLS = "match_id,tier,score,pair_type,need_side,supply_side,financing,why,mandate_code,priority_title,status,created_at";

/** Heaven and Strong matches from the match_board view, best first. */
export async function boardLoad(): Promise<BoardRow[]> {
  return must(await supabase.from("match_board").select(BOARD_COLS).order("score", { ascending: false }).limit(200)) as unknown as BoardRow[];
}

/** "Not a fit": rejects the match through the checked function (it records reject_reason, which rejected matches require). */
export async function matchNotFit(id: string): Promise<void> {
  invalidate("board");
  await matchDecide(id, "reject", "Kuran: not a fit");
}

/** Queue a Find: the daily engine run (or a Claude chat via the bridge) answers it onto the board. Returns the request id. */
export async function findRequestAdd(query: string): Promise<string> {
  const rows = must(await supabase.from("find_requests").insert({ query: query.trim() }).select("id")) as { id: string }[];
  const id = rows?.[0]?.id;
  if (!id) throw new Error("The Find request was not saved. Reload and try again.");
  return id;
}

/** Deal lines as the CRM spells them, from an engine line. */
const DEAL_LINE: Record<string, string> = { critical_power: "Critical power", compute: "Compute", capital: "Capital", powered_land: "Powered land" };

/** Move a match into the CRM as a qualified deal, next step in three days. Returns the new deal's id. */
export async function matchToDeal(matchId: string, today = ukToday()): Promise<{ id: string; deal: string }> {
  const m = (must(await supabase.from("v_match_cards").select("id,line,supply_title,need_title,mandate_label,explanation").eq("id", matchId).limit(1)) as {
    line: string | null; supply_title: string | null; need_title: string | null; mandate_label: string | null; explanation: { next_step?: unknown } | null;
  }[])[0];
  if (!m) throw new Error("That match is no longer open. Reload and try again.");
  const deal = [m.need_title, m.supply_title].filter(Boolean).join(" ↔ ") || m.mandate_label || "Match";
  const next = typeof m.explanation?.next_step === "string" && m.explanation.next_step.trim()
    ? m.explanation.next_step.trim()
    : "Name the decision maker and send the first touch";
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3);
  const row = {
    deal: deal.slice(0, 200),
    counterparty: m.supply_title ?? m.need_title ?? null,
    line: m.line ? DEAL_LINE[m.line] ?? null : null,
    stage: "Qualified",
    next_step: next,
    next_date: d.toISOString().slice(0, 10),
    notes: m.mandate_label ? `From engine match on ${m.mandate_label}.` : "From an engine match.",
    extra: { match_id: matchId },
  };
  const rows = must(await supabase.from("deals").insert(row).select("id")) as { id: string }[];
  if (!rows?.[0]?.id) throw new Error("The deal was not saved. Reload and try again.");
  return { id: rows[0].id, deal: row.deal };
}

// ---------- the Send deck: hold, fit, older approved ----------

/** Hold drafts: status parked, with the reason appended to each note. Only drafts and unsent approvals move. */
export async function outreachHold(rows: Pick<Outreach, "id" | "note">[], reason: HoldKey, other = ""): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 10) {
    const res = await Promise.all(rows.slice(i, i + 10).map((r) =>
      supabase.from("outreach").update({ status: "parked", note: holdNote(r.note, reason, other) }).eq("id", r.id).in("status", ["draft", "approved"]).select("id"),
    ));
    for (const r of res) n += (must(r) as unknown[] | null)?.length ?? 0;
  }
  return n;
}

/** Fit scores for the people the deck writes to (from their lead record), keyed by outreach id. */
export async function deckFit(rows: Pick<Outreach, "id" | "contact_id">[]): Promise<Map<string, number>> {
  const ids = [...new Set(rows.map((r) => r.contact_id).filter(Boolean))] as string[];
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const res = await supabase.from("lead_candidates").select("contact_id,fit_score").in("contact_id", ids.slice(0, 300)).not("fit_score", "is", null);
  if (res.error) return out;
  const byContact = new Map<string, number>();
  for (const l of (res.data ?? []) as { contact_id: string; fit_score: number | string }[]) {
    const f = Number(l.fit_score);
    if (Number.isFinite(f)) byContact.set(l.contact_id, Math.max(f, byContact.get(l.contact_id) ?? -1));
  }
  for (const r of rows) if (r.contact_id && byContact.has(r.contact_id)) out.set(r.id, byContact.get(r.contact_id)!);
  return out;
}

export const OLD_APPROVED_COLS = "id,to_name,company,subject,note,approved_at,created_at";
export type OldApproved = Pick<Outreach, "id" | "to_name" | "company" | "subject" | "note" | "approved_at" | "created_at">;

/** Emails approved under the old scheduled sending and never sent (written before the 27 Oct outbound style). */
export async function oldApprovedLoad(): Promise<{ rows: OldApproved[]; count: number }> {
  const r = await supabase.from("outreach").select(OLD_APPROVED_COLS, { count: "exact" }).eq("status", "approved").is("sent_at", null)
    .order("approved_at", { ascending: true, nullsFirst: true }).limit(200);
  const { rows, count } = mustCountRows(r);
  return { rows: rows as unknown as OldApproved[], count };
}

/** Park every older approved email: status parked, note "| parked 27 Oct: old style". Nothing is sent. */
export async function oldApprovedParkAll(rows: Pick<Outreach, "id" | "note">[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 10) {
    const res = await Promise.all(rows.slice(i, i + 10).map((r) =>
      supabase.from("outreach").update({ status: "parked", note: `${r.note ?? ""}${OLD_STYLE_NOTE}` }).eq("id", r.id).eq("status", "approved").is("sent_at", null).select("id"),
    ));
    for (const x of res) n += (must(x) as unknown[] | null)?.length ?? 0;
  }
  return n;
}

function mustCountRows<T>(res: { data: T[] | null; count: number | null; error: { message: string; code?: string } | null }): { rows: T[]; count: number } {
  if (res.error) throw new DbError(res.error);
  return { rows: res.data ?? [], count: res.count ?? (res.data?.length ?? 0) };
}

/** "Move to deal" on a reply: a Lead-stage deal for that person, linked to their contact, next step due in two days. */
export async function dealFromReply(r: { to_name: string | null; to_email: string; company: string | null; contact_id: string | null; outreach_id: string }): Promise<string> {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 2);
  const row = {
    deal: `${r.company || r.to_name || r.to_email}`.slice(0, 200),
    counterparty: r.company ?? r.to_name ?? null,
    contact_id: r.contact_id,
    stage: "Lead",
    next_step: "Answer their reply and book a call",
    next_date: d.toISOString().slice(0, 10),
    notes: `From an email reply (${r.to_email}).`,
    extra: { outreach_id: r.outreach_id },
  };
  const rows = must(await supabase.from("deals").insert(row).select("id")) as { id: string }[];
  if (!rows?.[0]?.id) throw new Error("The deal was not saved. Reload and try again.");
  return rows[0].id;
}
