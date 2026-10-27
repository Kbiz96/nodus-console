// Rules behind the Send deck: hold reasons, mandate groups with counts, one email per company, and the older
// approved queue. Pure functions only, so they can be unit-tested.
import type { Outreach, Priority } from "./types.ts";

export const HOLD_REASONS = [
  { key: "same_firm", label: "Second contact at same firm" },
  { key: "live_account", label: "Live account" },
  { key: "later", label: "Later" },
  { key: "other", label: "Other" },
] as const;
export type HoldKey = (typeof HOLD_REASONS)[number]["key"];

const ukShort = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });

/** The note after a hold: the reason (and Kuran's words for Other) appended, so the draft says why it is parked. */
export function holdNote(note: string | null | undefined, reason: HoldKey, other = "", now = new Date()): string {
  const label = HOLD_REASONS.find((r) => r.key === reason)?.label ?? "Held";
  const why = reason === "other" && other.trim() ? `${label}: ${other.trim()}` : label;
  return `${note ?? ""} | held ${ukShort.format(now)}: ${why}`.replace(/^ \| /, "");
}

/** What "Park all" writes on the older approved emails. */
export const OLD_STYLE_NOTE = " | parked 27 Oct: old style";

/** Personal mailboxes are not a company: two drafts to gmail.com are not a clash. */
const GENERIC = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com"]);

export function emailDomain(email: string | null | undefined): string | null {
  const d = (email ?? "").trim().toLowerCase().split("@")[1];
  if (!d || !d.includes(".") || GENERIC.has(d)) return null;
  return d;
}

export interface Clash { domain: string; keep: string; others: string[] }

/**
 * Two or more email drafts to the same company domain: the one with the higher fit is kept (ties: the one already
 * earlier in the queue); the rest are the "others" that Send holds as a second contact at the same firm.
 * Returns the clash for every row involved, keyed by outreach id.
 */
export function companyClashes<T extends Pick<Outreach, "id" | "to_email">>(rows: T[], fit: Map<string, number>): Map<string, Clash> {
  const byDomain = new Map<string, T[]>();
  for (const r of rows) {
    const d = emailDomain(r.to_email);
    if (!d) continue;
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d)!.push(r);
  }
  const out = new Map<string, Clash>();
  for (const [domain, rs] of byDomain) {
    if (rs.length < 2) continue;
    let best = rs[0];
    for (const r of rs) if ((fit.get(r.id) ?? -1) > (fit.get(best.id) ?? -1)) best = r;
    const clash = { domain, keep: best.id, others: rs.filter((r) => r.id !== best.id).map((r) => r.id) };
    for (const r of rs) out.set(r.id, clash);
  }
  return out;
}

export interface DeckGroup { key: string; label: string; ids: string[] }

/** The deck's rows grouped by mandate (priority), in the deck's order, with no-priority last. */
export function deckGroups<T extends Pick<Outreach, "id" | "priority_id">>(ordered: T[], priorities: Pick<Priority, "id" | "rank" | "title">[]): DeckGroup[] {
  const pr = new Map(priorities.map((p) => [p.id, p]));
  const groups = new Map<string, DeckGroup>();
  for (const r of ordered) {
    const p = r.priority_id ? pr.get(r.priority_id) : undefined;
    const key = p ? p.id : "none";
    if (!groups.has(key)) groups.set(key, { key, label: p ? `${p.rank}. ${p.title}` : "No mandate", ids: [] });
    groups.get(key)!.ids.push(r.id);
  }
  const list = [...groups.values()];
  return [...list.filter((g) => g.key !== "none"), ...list.filter((g) => g.key === "none")];
}

/** Move one group's rows to the front of the queue, keeping everyone's order otherwise. */
export function frontGroup(queue: string[], ids: string[]): string[] {
  const set = new Set(ids);
  return [...queue.filter((id) => set.has(id)), ...queue.filter((id) => !set.has(id))];
}
