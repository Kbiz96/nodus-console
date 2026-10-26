// New leads for a signed mandate: people Claude scouted outside the CRM (Apollo, 8Raise, the web) waiting for
// Kuran's approve or dismiss, the approved ones waiting for outbound, and the two Claude instructions.
// Pure functions only, so they can be unit-tested.

import type { Priority } from "./types.ts";

export type LeadStatus = "new" | "approved" | "dismissed" | "drafted";
export type LeadSource = "apollo" | "8raise" | "web" | "engine";

/** A row of lead_candidates. */
export interface Lead {
  id: string;
  priority_id: string;
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
  "id,priority_id,name,title,company,company_domain,linkedin,country,source,source_ref,hook,hook_url,fit_score,fit_reason,status,contact_id,decided_at,created_at";

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
export function leadQueues<T extends Lead>(rows: T[], priorityId: string, over: LeadOverrides = new Map()): LeadQueues<T> {
  const mine = withOverrides(rows.filter((r) => r.priority_id === priorityId), over);
  return {
    fresh: sortLeads(mine.filter((r) => r.status === "new")),
    approved: sortLeads(mine.filter((r) => r.status === "approved")),
  };
}

/** New-lead counts per priority, with on-screen decisions applied. */
export function newLeadCounts(rows: Pick<Lead, "id" | "priority_id" | "status">[], over: LeadOverrides = new Map()): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of withOverrides(rows, over)) if (r.status === "new") m.set(r.priority_id, (m.get(r.priority_id) ?? 0) + 1);
  return m;
}

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
}

type PromptPriority = Pick<Priority, "rank" | "title">;

/**
 * "Write outbound for N": one Claude chat that enriches each approved lead with Apollo, finds a sourced hook,
 * creates the CRM contact, drafts, and sends from Gmail only when Kuran replies "send".
 */
export function writeOutboundPrompt(leads: Pick<Lead, "id" | "name" | "title" | "company" | "source" | "source_ref">[], p: PromptPriority): string {
  const n = leads.length;
  const head =
    `Nodus command (priority ${p.rank}: ${clean(p.title)}). Write best-in-class outbound for these ${n} approved leads (lead_candidates ids below). ` +
    "For each: enrich with Apollo by source_ref (work email, full name, LinkedIn; report credits), research one recent sourced hook about them or their firm, " +
    "create/merge the crm_contacts record, then draft one email (and a LinkedIn DM if no work email) with the nodus-command playbook; " +
    "blind brief only, no client names, no fees. Save drafts tagged to this priority, set each lead's status to 'drafted' and contact_id, " +
    "show me all drafts here, and when I reply \"send\", send the emails from Gmail within the daily cap and record them.";
  const lines = leads.map((x, i) => {
    const who = [clean(x.name) || "Unnamed lead", clean(x.title), clean(x.company)].filter(Boolean).join(", ");
    const src = (x.source ?? "").toLowerCase() || "source";
    const ref = clean(x.source_ref);
    return `${i + 1}. ${who} (lead ${x.id}${ref ? `, ${src} ${ref}` : ""})`;
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
