// Signed mandates on Focus: the signed badge from the linked deal, grouping priorities that serve one mandate,
// labels for the network list, the Claude prompts, and keeping parked drafts out of the way.
// Pure functions only, so they can be unit-tested.

import { isOverdue, isYes, ukToday } from "./crm.ts";
import { reference } from "./format.ts";
import type { Deal, NetworkRow, Priority } from "./types.ts";

// ---------- the signed badge ----------

export type ChipTone = "ok" | "warn" | "off";
export interface SignChip { label: string; tone: ChipTone }
export interface SignedState {
  /** "signed" when an NCNDA or fee letter is in place, "unsigned" when neither is, "none" when no deal is linked. */
  state: "signed" | "unsigned" | "none";
  badge: string | null;
  chips: SignChip[];
}

type DealGateFields = Pick<Deal, "ncnda_signed" | "fee_signed">;

function isNo(v: unknown): boolean {
  return typeof v === "string" && v.trim().toLowerCase() === "no";
}

/**
 * What the linked deal(s) say about paper: NCNDA and fee protection. A gate counts as signed if any linked
 * deal has it as "Yes"; "No" shows as outstanding; "N/A" and blanks show nothing.
 */
export function signedState(deals: DealGateFields[]): SignedState {
  if (deals.length === 0) return { state: "none", badge: null, chips: [] };
  const any = (k: keyof DealGateFields, f: (v: unknown) => boolean) => deals.some((d) => f(d[k]));
  const fee = any("fee_signed", isYes) ? "yes" : any("fee_signed", isNo) ? "no" : "na";
  const nda = any("ncnda_signed", isYes) ? "yes" : any("ncnda_signed", isNo) ? "no" : "na";
  const chips: SignChip[] = [];
  if (fee === "yes") chips.push({ label: "Fee protected ✓", tone: "ok" });
  if (nda === "yes") chips.push({ label: "NCNDA ✓", tone: "ok" });
  if (nda === "no") chips.push({ label: "NCNDA outstanding", tone: "warn" });
  if (fee === "no") chips.push({ label: "Fee letter outstanding", tone: "warn" });
  const signed = fee === "yes" || nda === "yes";
  return { state: signed ? "signed" : "unsigned", badge: signed ? "Signed" : "Not signed yet", chips };
}

export interface DealNext { text: string; date: string | null; overdue: boolean }

/** The deal's next step and date. With several deals, the earliest dated one wins. */
export function dealNext(deals: Pick<Deal, "next_step" | "next_date">[], today = ukToday()): DealNext | null {
  const withStep = deals.filter((d) => (d.next_step ?? "").trim() || d.next_date);
  if (withStep.length === 0) return null;
  const d = [...withStep].sort((a, b) => (a.next_date ?? "9999") < (b.next_date ?? "9999") ? -1 : 1)[0];
  return { text: (d.next_step ?? "").replace(/\s+/g, " ").trim(), date: d.next_date ?? null, overdue: isOverdue(d.next_date, today) };
}

// ---------- grouping priorities into mandates ----------

type GroupPriority = Pick<Priority, "id" | "rank" | "title" | "deal_ids"> & { target_lines?: string[] | null };

export interface MandateGroup<P extends GroupPriority> {
  key: string;
  /** "Al-Risha phase 1 (Mindstream)": the shared part of the titles, else the deal's name, else the title. */
  name: string;
  members: P[];
  dealIds: string[];
}

/** The part of a title before the first colon, e.g. "Al-Risha phase 1 (Mindstream)". */
export function titleHead(title: string): string {
  const i = title.indexOf(":");
  return (i > 0 ? title.slice(0, i) : title).trim();
}

/** The part after the first colon, e.g. "find the offtaker". Empty when there is none. */
export function titleTail(title: string): string {
  const i = title.indexOf(":");
  return i > 0 ? title.slice(i + 1).trim() : "";
}

/**
 * Priorities that serve the same mandate become one group: they share a linked deal, or their titles share the
 * same part before the colon. Groups keep the order of their best-ranked member. `dealName` names a group whose
 * titles do not share a head.
 */
export function groupPriorities<P extends GroupPriority>(ps: P[], dealName: (id: string) => string | null = () => null): MandateGroup<P>[] {
  const sorted = [...ps].sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
  const groups: MandateGroup<P>[] = [];
  for (const p of sorted) {
    const deals = p.deal_ids ?? [];
    const head = titleTail(p.title) ? titleHead(p.title).toLowerCase() : null;
    const g = groups.find((x) =>
      x.dealIds.some((d) => deals.includes(d)) || (head !== null && x.members.some((m) => titleTail(m.title) && titleHead(m.title).toLowerCase() === head)),
    );
    if (g) {
      g.members.push(p);
      for (const d of deals) if (!g.dealIds.includes(d)) g.dealIds.push(d);
    } else {
      groups.push({ key: p.id, name: "", members: [p], dealIds: [...deals] });
    }
  }
  for (const g of groups) {
    const heads = new Set(g.members.map((m) => titleHead(m.title)));
    const shared = heads.size === 1 && g.members.every((m) => titleTail(m.title)) ? [...heads][0] : null;
    const fromDeal = g.dealIds.map(dealName).find((n): n is string => Boolean(n && n.trim()));
    g.name = g.members.length === 1 ? (titleTail(g.members[0].title) ? titleHead(g.members[0].title) : g.members[0].title) : shared ?? (fromDeal ? titleHead(fromDeal) : g.members[0].title);
  }
  return groups;
}

/** Show groups until the top `n` priorities are on screen; the rest are one tap away. */
export function splitVisible<P extends GroupPriority>(groups: MandateGroup<P>[], n = 3): { shown: MandateGroup<P>[]; hidden: MandateGroup<P>[] } {
  const shown: MandateGroup<P>[] = [];
  let count = 0;
  for (const g of groups) {
    if (count >= n) break;
    shown.push(g);
    count += g.members.length;
  }
  return { shown, hidden: groups.slice(shown.length) };
}

const LINE_WORKSTREAM: Record<string, string> = {
  "Compute-Buy": "Offtakers",
  "Capital-Provide": "Investors",
  "Compute-Sell": "Suppliers",
  "Power-Sell": "Power suppliers",
  "Power-Buy": "Power buyers",
  "Land-Buy": "Site buyers",
  "Land-Sell": "Sites",
  "Capital-Raise": "Borrowers",
  Introducer: "Introducers",
};

/** A short name for one workstream of a mandate: "Offtakers", "Investors", "Suppliers"… */
export function workstreamLabel(p: Pick<Priority, "title"> & { target_lines?: string[] | null }): string {
  const names = [...new Set((p.target_lines ?? []).map((l) => LINE_WORKSTREAM[l]).filter(Boolean))];
  if (names.length === 1) return names[0];
  if (names.length > 1) return `${names[0]} and ${names.slice(1).join(", ").toLowerCase()}`;
  const tail = titleTail(p.title);
  return tail ? tail.charAt(0).toUpperCase() + tail.slice(1) : p.title;
}

/** True for a priority whose job is finding suppliers (quotes and equipment), e.g. DIGGERS. */
export function isSupplyPriority(p: { target_lines?: string[] | null }): boolean {
  return (p.target_lines ?? []).some((l) => l === "Compute-Sell" || l === "Power-Sell");
}

export function networkHeading(p: { target_lines?: string[] | null }): string {
  return isSupplyPriority(p) ? "Suppliers and integrators in your network" : "Best in your network";
}

// ---------- the network list ----------

/** Width of a score bar, 0–100. Scores are about 0–100 but can run a little over; clamp them. */
export function scoreWidth(score: number | null | undefined): number {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, Math.round(n));
}

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
}

/** "Draft for me": the instruction for Claude to write a first message to one person in the network. */
export function draftForPrompt(person: Pick<NetworkRow, "name" | "title" | "company">, p: Pick<Priority, "rank" | "title">): string {
  const role = [clean(person.title), clean(person.company)].filter(Boolean).join(", ");
  const who = `${clean(person.name) || "this contact"}${role ? ` (${role})` : ""}`;
  return `Nodus command: draft a first message to ${who} for priority ${p.rank}: ${clean(p.title)}. Use their CRM record and the nodus-command playbook; put it in my console for approval.`;
}

/**
 * "Ask Claude: get quotes" for a supplier priority. The mandate's name never goes to suppliers: the RFQ is anonymised.
 * "DIGGERS 100 MW: equipment quotes and suppliers" → priority 3: DIGGERS, the 100 MW BOM.
 */
export function quotesPrompt(p: Pick<Priority, "rank" | "title">): string {
  const head = titleHead(p.title);
  const name = head.split(/\s+/)[0] || head;
  const mw = /(\d[\d.,]*\s*MW)\b/i.exec(head)?.[1]?.replace(/\s+/g, " ");
  const bom = mw ? `the ${mw} BOM` : "the BOM";
  return `Nodus command (priority ${p.rank}: ${name}): prepare an anonymised RFQ for ${bom} (no ${name} name or project details) to the best 5 integrators/suppliers in my network and new ones; draft for my approval.`;
}

/** "Enrich & draft" on an engine opportunity (or both sides of a match). */
export function enrichPrompt(opps: { id: string; title: string | null }[]): string {
  const ref = (o: { id: string; title: string | null }) => `${reference(o.id)}${clean(o.title) ? ` (${clean(o.title)})` : ""}`;
  const list = opps.map(ref);
  const what = list.length <= 1 ? `opportunity ${list[0] ?? ""}` : `opportunities ${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  return `Nodus command: enrich ${what} with decision makers (Apollo, work emails only) and draft first touches tied to my top priority that fits; put drafts in my console.`;
}

// ---------- parked drafts ----------

/** Old drafts kept for later. Never in the deck, counts, badges or LinkedIn lists. */
export const PARKED = "parked";

export function isParked(o: { status: string | null | undefined }): boolean {
  return o.status === PARKED;
}

export function withoutParked<T extends { status: string | null | undefined }>(rows: T[]): T[] {
  return rows.filter((r) => !isParked(r));
}
