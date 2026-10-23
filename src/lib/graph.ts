// Layout for the matchmaking view: demand on the left (mandate cards, or the need when a pair has no mandate),
// opportunities on the right, one curve per match. Pure functions only, so they can be unit-tested.
import type { MatchCardRow } from "./types.ts";

export interface GNode {
  key: string;
  side: "left" | "right";
  kind: "mandate" | "opportunity";
  id: string; // mandate or opportunity id
  label: string;
  line: string | null;
  gate: string | null;
  weight: number; // sum of match scores
  degree: number;
  y: number; // 0..1, centre of the node
}

export interface GLink {
  match: MatchCardRow;
  left: string;
  right: string;
  score: number;
}

export interface Graph {
  left: GNode[];
  right: GNode[];
  links: GLink[];
}

function ends(m: MatchCardRow): { l: Omit<GNode, "weight" | "degree" | "y">; r: Omit<GNode, "weight" | "degree" | "y"> } | null {
  if (m.mandate_id) {
    const oppId = m.supply_id ?? m.need_id;
    if (!oppId) return null;
    const isSupply = Boolean(m.supply_id);
    return {
      l: { key: `m:${m.mandate_id}`, side: "left", kind: "mandate", id: m.mandate_id, label: m.mandate_label || "Mandate", line: m.line, gate: null },
      r: {
        key: `o:${oppId}`, side: "right", kind: "opportunity", id: oppId,
        label: (isSupply ? m.supply_title : m.need_title) || "Opportunity", line: m.line,
        gate: isSupply ? m.supply_gate : m.need_gate,
      },
    };
  }
  if (!m.need_id || !m.supply_id) return null;
  return {
    l: { key: `o:${m.need_id}`, side: "left", kind: "opportunity", id: m.need_id, label: m.need_title || "Need", line: m.line, gate: m.need_gate },
    r: { key: `o:${m.supply_id}`, side: "right", kind: "opportunity", id: m.supply_id, label: m.supply_title || "Supply", line: m.line, gate: m.supply_gate },
  };
}

/**
 * Build the two columns. Left nodes are ordered by total score (strongest at the top); right nodes by the
 * score-weighted average position of the left nodes they connect to, which keeps crossings down.
 * Positions are evenly spaced in 0..1 so both columns span the same height.
 */
export function buildGraph(matches: MatchCardRow[]): Graph {
  const left = new Map<string, GNode>();
  const right = new Map<string, GNode>();
  const links: GLink[] = [];
  for (const m of matches) {
    const e = ends(m);
    if (!e) continue;
    const score = Number(m.total_score) || 0;
    // An opportunity can be on the left (as a need) and also appear on the right; keep the columns separate.
    const l = left.get(e.l.key) ?? { ...e.l, weight: 0, degree: 0, y: 0 };
    const r = right.get(e.r.key) ?? { ...e.r, weight: 0, degree: 0, y: 0 };
    l.weight += score;
    l.degree += 1;
    r.weight += score;
    r.degree += 1;
    left.set(e.l.key, l);
    right.set(e.r.key, r);
    links.push({ match: m, left: e.l.key, right: e.r.key, score });
  }
  const L = [...left.values()].sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));
  L.forEach((n, i) => (n.y = (i + 0.5) / L.length));
  const pos = new Map(L.map((n) => [n.key, n.y]));
  const bary = new Map<string, { s: number; w: number; best: number }>();
  for (const k of links) {
    const b = bary.get(k.right) ?? { s: 0, w: 0, best: 0 };
    b.s += (pos.get(k.left) ?? 0) * k.score;
    b.w += k.score;
    b.best = Math.max(b.best, k.score);
    bary.set(k.right, b);
  }
  const at = (key: string) => {
    const b = bary.get(key);
    return b && b.w > 0 ? b.s / b.w : 0;
  };
  const R = [...right.values()].sort(
    (a, b) => at(a.key) - at(b.key) || (bary.get(b.key)?.best ?? 0) - (bary.get(a.key)?.best ?? 0) || a.label.localeCompare(b.label),
  );
  R.forEach((n, i) => (n.y = (i + 0.5) / R.length));
  links.sort((a, b) => a.score - b.score); // strongest drawn last, on top
  return { left: L, right: R, links };
}

/** Stroke width and opacity for a link of this score (0–100). */
export function linkStyle(score: number): { width: number; opacity: number } {
  const t = Math.max(0, Math.min(1, (score - 40) / 50));
  return { width: Math.round((0.6 + t * 3.4) * 10) / 10, opacity: Math.round((0.18 + t * 0.62) * 100) / 100 };
}

/** A smooth horizontal S-curve from (x1, y1) to (x2, y2). */
export function curve(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M${x1.toFixed(1)},${y1.toFixed(1)} C${mx.toFixed(1)},${y1.toFixed(1)} ${mx.toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
}

/** Shorten a label to about `max` characters on a word boundary. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, Math.max(1, max - 1));
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}
