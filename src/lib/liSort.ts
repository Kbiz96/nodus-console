// Sorting for the LinkedIn lists on Today (DMs, connection notes, comments). Pure functions, unit-tested.
// Default is newest first, so the latest agent run is always at the top.

import type { Outreach } from "./types.ts";

export type LiSortKey = "newest" | "oldest" | "post" | "reach" | "fit" | "lane" | "name" | "company";
export type LiListKind = "dm" | "note" | "comment";

type Row = Pick<Outreach, "created_at" | "note" | "to_name" | "company">;

const LABELS: Record<LiSortKey, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  post: "Freshest post first",
  reach: "Biggest audience first",
  fit: "Best fit first",
  lane: "Lane",
  name: "Name A–Z",
  company: "Company A–Z",
};

/** The sort options that make sense for each list. */
export function sortOptions(kind: LiListKind): { k: LiSortKey; label: string }[] {
  const keys: LiSortKey[] =
    kind === "comment" ? ["newest", "post", "reach", "oldest", "name", "company"] : ["newest", "oldest", "fit", "lane", "name", "company"];
  return keys.map((k) => ({ k, label: LABELS[k] }));
}

export function isSortKey(v: unknown, kind: LiListKind): v is LiSortKey {
  return typeof v === "string" && sortOptions(kind).some((o) => o.k === v);
}

/** "fit A" / "fit B" from the agent's note; speed scores S7+ count as A and S5–S6 as B. Null when ungraded. */
export function fitOf(note: string | null | undefined): "A" | "B" | null {
  const m = /\bfit\s+([AB])\b/i.exec(note ?? "");
  if (m) return m[1].toUpperCase() as "A" | "B";
  const s = /·\s*S(\d{1,2})\b/.exec(note ?? "");
  if (!s) return null;
  const n = Number(s[1]);
  return n >= 7 ? "A" : n >= 5 ? "B" : null;
}

/**
 * The author's audience when the agent found the post: "reach 290k followers" or "reach 12,400". Used to put the
 * comments that will be seen most at the top (Kuran, 19 Nov: comment early on the biggest voices).
 */
export function reachOf(note: string | null | undefined): number | null {
  const m = /\breach\s+([\d.,]+)\s*([km])?\b/i.exec(note ?? "");
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const mult = m[2]?.toLowerCase() === "m" ? 1_000_000 : m[2]?.toLowerCase() === "k" ? 1_000 : 1;
  return Math.round(n * mult);
}

/**
 * The lane the agent tagged ("LI: CAPITAL · ...", "LI v3: GPU-SUPPLY · ..."), even after a prefix such as
 * "REWRITTEN 18 Nov 2026 · ". GPU-SUPPLY, GPU-DEMAND and GPU-FINANCE are the compute lane. Comments have none.
 */
export function laneTag(note: string | null | undefined): string | null {
  const m = /\bLI(?:\s*v\d+)?:\s*(CAPITAL|OFFTAKERS?|COMPUTE|OPERATORS|POWER|MAGNET|GPU-(?:SUPPLY|DEMAND|FINANCE))\b/.exec(note ?? "");
  if (!m) return null;
  if (m[1].startsWith("GPU-")) return "COMPUTE";
  return m[1].startsWith("OFFTAKER") ? "OFFTAKERS" : m[1];
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * When the post being commented on went up. The agent writes either "WHY: <author> post, 16 Nov 2026" or
 * "posted 3h ago" (relative to when the draft was made). Null when neither is there.
 */
export function postDate(o: Pick<Outreach, "note" | "created_at">): Date | null {
  const note = o.note ?? "";
  const abs = /post,\s*(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(note);
  if (abs) {
    const mon = MONTHS.indexOf(abs[2].toLowerCase());
    if (mon >= 0) return new Date(Date.UTC(Number(abs[3]), mon, Number(abs[1]), 12));
  }
  const rel = /posted\s+(\d+)\s*(m|h|d|w)\b/i.exec(note);
  const made = Date.parse(o.created_at);
  if (rel && Number.isFinite(made)) {
    const mins = { m: 1, h: 60, d: 1440, w: 10080 }[rel[2].toLowerCase() as "m" | "h" | "d" | "w"];
    return new Date(made - Number(rel[1]) * mins * 60_000);
  }
  return null;
}

const time = (s: string | null | undefined) => {
  const t = Date.parse(s ?? "");
  return Number.isFinite(t) ? t : 0;
};
const text = (s: string | null | undefined) => (s ?? "").trim().toLocaleLowerCase("en-GB");
const byText = (a: string, b: string) => {
  // Blanks go last whatever the order.
  if (!a && b) return 1;
  if (a && !b) return -1;
  return a.localeCompare(b, "en-GB");
};

/** A sorted copy. Ties fall back to newest first, so the order never jumps between reloads. */
export function sortLinkedIn<T extends Row>(rows: T[], key: LiSortKey): T[] {
  const newest = (a: T, b: T) => time(b.created_at) - time(a.created_at);
  const cmp: Record<LiSortKey, (a: T, b: T) => number> = {
    newest,
    oldest: (a, b) => -newest(a, b),
    post: (a, b) => (postDate(b)?.getTime() ?? 0) - (postDate(a)?.getTime() ?? 0),
    reach: (a, b) => (reachOf(b.note) ?? -1) - (reachOf(a.note) ?? -1),
    fit: (a, b) => {
      const r = (x: T) => { const f = fitOf(x.note); return f === "A" ? 0 : f === "B" ? 1 : 2; };
      return r(a) - r(b);
    },
    lane: (a, b) => byText(text(laneTag(a.note)), text(laneTag(b.note))),
    name: (a, b) => byText(text(a.to_name), text(b.to_name)),
    company: (a, b) => byText(text(a.company), text(b.company)),
  };
  return [...rows].sort((a, b) => cmp[key](a, b) || newest(a, b));
}

/** "16 Nov" (or "16 Nov 2025" outside this year) for the row meta line. */
export function shortDay(d: Date | string | null | undefined, now = new Date()): string | null {
  const t = d instanceof Date ? d.getTime() : Date.parse(d ?? "");
  if (!Number.isFinite(t)) return null;
  const x = new Date(t);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", timeZone: "Europe/London" };
  if (x.getUTCFullYear() !== now.getUTCFullYear()) opts.year = "numeric";
  return x.toLocaleDateString("en-GB", opts);
}
