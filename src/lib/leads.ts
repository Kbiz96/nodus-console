// New leads for a signed mandate: people Claude scouted outside the CRM (Apollo, 8Raise, the web) waiting for
// Kuran's approve or dismiss, the approved ones waiting for outbound, and the two Claude instructions.
// Pure functions only, so they can be unit-tested.

import type { Priority } from "./types.ts";

export type LeadStatus = "new" | "approved" | "dismissed" | "drafted";
export type LeadSource = "apollo" | "8raise" | "web" | "engine";

/** A row of lead_candidates. */
export interface Lead {
  id: string;
  /** null = a Background BD lead from the engine, not tied to a signed mandate. */
  priority_id: string | null;
  opportunity_id?: string | null;
  match_id?: string | null;
  /** The opportunity's line (capital, powered_land, compute), joined on screen for Background BD leads. */
  line?: string | null;
  name: string;
  title: string | null;
  company: string | null;
  company_domain: string | null;
  linkedin: string | null;
  country: string | null;
  source: LeadSource | string;
  source_ref: string | null;
  hook: string | null;
  hook_url: string | null;
  fit_score: number | null;
  fit_reason: string | null;
  status: LeadStatus;
  contact_id: string | null;
  decided_at: string | null;
  created_at: string;
}

export const LEAD_COLS =
  "id,priority_id,opportunity_id,match_id,name,title,company,company_domain,linkedin,country,source,source_ref,hook,hook_url,fit_score,fit_reason,status,contact_id,decided_at,created_at";

/** How long the Undo stays on screen after approve or dismiss. */
export const LEAD_UNDO_MS = 6000;

const SOURCE_LABEL: Record<string, string> = { apollo: "Apollo", "8raise": "8Raise", web: "Web", engine: "Engine" };

/** "Apollo", "8Raise", "Web", "Engine"; anything else as written. */
export function sourceLabel(source: string | null | undefined): string {
  const s = (source ?? "").trim();
  return SOURCE_LABEL[s.toLowerCase()] ?? (s || "Unknown");
}

/** Best fit first; no score last; then newest first; then by name, so the order never jumps. */
export function sortLeads<T extends Pick<Lead, "fit_score" | "created_at" | "name">>(rows: T[]): T[] {
  const score = (r: T) => (Number.isFinite(Number(r.fit_score)) && r.fit_score !== null ? Number(r.fit_score) : -1);
  return [...rows].sort((a, b) =>
    score(b) - score(a) || (b.created_at ?? "").localeCompare(a.created_at ?? "") || (a.name ?? "").localeCompare(b.name ?? ""),
  );
}

/** Decisions made on screen before the next reload, by lead id. */
export type LeadOverrides = Map<string, LeadStatus>;

/** The rows with on-screen decisions applied. */
export function withOverrides<T extends Pick<Lead, "id" | "status">>(rows: T[], over: LeadOverrides): T[] {
  return rows.map((r) => (over.has(r.id) ? { ...r, status: over.get(r.id) as LeadStatus } : r));
}

/** Record a decision for these leads (approve, dismiss, or "new" for Undo). Returns a new map. */
export function decide(over: LeadOverrides, ids: string[], status: LeadStatus): LeadOverrides {
  const next = new Map(over);
  for (const id of ids) next.set(id, status);
  return next;
}

/** The patch written for a decision: Undo ("new") clears decided_at. */
export function decisionPatch(status: LeadStatus, now = new Date()): { status: LeadStatus; decided_at: string | null } {
  return { status, decided_at: status === "new" ? null : now.toISOString() };
}

export interface LeadQueues<T> {
  /** status 'new', best fit first. */
  fresh: T[];
  /** status 'approved' (not yet drafted), best fit first. */
  approved: T[];
}

/** One priority's queue and approved strip. */
export function leadQueues<T extends Lead>(rows: T[], priorityId: string | null, over: LeadOverrides = new Map()): LeadQueues<T> {
  const mine = withOverrides(rows.filter((r) => (r.priority_id ?? null) === priorityId), over);
  return {
    fresh: sortLeads(mine.filter((r) => r.status === "new")),
    approved: sortLeads(mine.filter((r) => r.status === "approved")),
  };
}

/** New-lead counts per priority, with on-screen decisions applied. */
export function newLeadCounts(rows: Pick<Lead, "id" | "priority_id" | "status">[], over: LeadOverrides = new Map()): Map<string | null, number> {
  const m = new Map<string | null, number>();
  for (const r of withOverrides(rows, over)) if (r.status === "new") m.set(r.priority_id ?? null, (m.get(r.priority_id ?? null) ?? 0) + 1);
  return m;
}

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
}

type PromptPriority = Pick<Priority, "rank" | "title">;

/**
 * "Write outbound for N": one Claude chat that enriches each approved lead with Apollo, finds a sourced hook,
 * creates the CRM contact and drafts emails for approval in the console (LinkedIn only to 1st-degree connections, sent by Kuran).
 * With no priority (Background BD leads) the chat is told so, and each line carries the engine opportunity id.
 */
export function writeOutboundPrompt(
  leads: (Pick<Lead, "id" | "name" | "title" | "company" | "source" | "source_ref"> & { opportunity_id?: string | null })[],
  p: PromptPriority | null,
): string {
  const n = leads.length;
  const scope = p ? `priority ${p.rank}: ${clean(p.title)}` : "background BD, no priority";
  const save = p
    ? "Save drafts tagged to this priority"
    : "Save drafts with no priority (tie each to its engine opportunity)";
  const head =
    `Nodus command (${scope}). Write best-in-class outbound for these ${n} approved leads (lead_candidates ids below). ` +
    "For each: enrich with Apollo by source_ref (work email, full name, LinkedIn; report credits), research one recent sourced hook about them or their firm, " +
    "create/merge the crm_contacts record, then draft one email per OUTBOUND-PROMPT v3 (capital: relationship-first with the mandate range and a light close; " +
    "power and compute: direct; procurement: RFQ). Email first: a LinkedIn DM only if they are already a 1st-degree connection, and I send it myself; " +
    "no LinkedIn messages to people I'm not connected to. " +
    `Blind brief only, no client names, no fees. ${save}, set each lead's status to 'drafted' and contact_id, ` +
    "and show me the drafts here. Emails go into the console for my approval; nothing goes out until I press Send.";
  const lines = leads.map((x, i) => {
    const who = [clean(x.name) || "Unnamed lead", clean(x.title), clean(x.company)].filter(Boolean).join(", ");
    const src = (x.source ?? "").toLowerCase() || "source";
    const ref = clean(x.source_ref);
    const opp = !p && x.opportunity_id ? `, opportunity ${x.opportunity_id}` : "";
    return `${i + 1}. ${who} (lead ${x.id}${ref ? `, ${src} ${ref}` : ""}${opp})`;
  });
  return [head, ...lines].join("\n");
}

/** "Find 50 more": one Claude chat that runs a deep lead scout and puts the 50 best into lead_candidates. */
export function findMorePrompt(p: PromptPriority & Pick<Priority, "who" | "goal">): string {
  const who = clean(p.who) || clean(p.title);
  const goal = clean(p.goal) || clean(p.title);
  return (
    `Nodus command (priority ${p.rank}: ${clean(p.title)}). Deep lead scout: find the 50 best people in the world to get in front of for this mandate. ` +
    `Who we need: "${who}". Goal: "${goal}". Follow the nodus-command playbook section "Deep lead scout": first define who is perfect ` +
    "(firm types, live signals that prove fit, decision-maker roles), then search every source (Apollo people and companies, 8Raise for investors, " +
    "recent news and deal announcements, the engine's opportunities and signals, Clay/Vibe if useful), score each lead on evidence of fit, and insert " +
    "the top 50 into lead_candidates (status 'new') with fit_score, fit_reason, and a sourced hook + hook_url for each. Skip anyone already in " +
    "crm_contacts, outreach, lead_candidates or network_dismissals for this priority, and companies we're already in conversation with. " +
    "Tell me how many you added and the top 10."
  );
}

/** Next row index for J/K, clamped to the list. */
export function moveCursor(i: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, i + delta));
}
