// Filters live in the address (after the #), so a filtered page can be bookmarked or shared.
import { GATES, isLine, MATCH_STATUSES, SIDES } from "./labels.ts";

export interface Filters {
  q: string;
  line: string | null;
  country: string | null;
  from: string | null; // YYYY-MM-DD, UK day
  to: string | null;
  minMw: number | null;
  side: string | null;
  status: string | null;
  source: string | null;
  gate: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string | null | undefined): s is string => typeof s === "string" && UUID_RE.test(s);

function isoDay(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

export function parseFilters(sp: URLSearchParams): Filters {
  const one = (k: string) => (sp.get(k) ?? "").trim();
  const country = one("country").toUpperCase();
  const mwRaw = one("mw");
  const mw = Number(mwRaw);
  return {
    q: one("q").replace(/\s+/g, " ").slice(0, 200),
    line: isLine(one("line")) ? one("line") : null,
    country: /^[A-Z]{2}$/.test(country) ? country : null,
    from: isoDay(one("from")),
    to: isoDay(one("to")),
    minMw: mwRaw !== "" && Number.isFinite(mw) && mw > 0 ? mw : null,
    side: (SIDES as readonly string[]).includes(one("side")) ? one("side") : null,
    status: (MATCH_STATUSES as readonly string[]).includes(one("status")) ? one("status") : null,
    source: isUuid(one("source")) ? one("source") : null,
    gate: (GATES as readonly string[]).includes(one("gate")) ? one("gate") : null,
  };
}

export function hasAnyFilter(f: Filters): boolean {
  return Boolean(f.q || f.line || f.country || f.from || f.to || f.minMw);
}

/** Build "path?query" from a set of values, leaving out empty ones. */
export function hrefWith(path: string, params: Record<string, string | number | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `${path}?${s}` : path;
}

export function pageFrom(sp: URLSearchParams): number {
  const v = Number(sp.get("page"));
  return Number.isInteger(v) && v > 0 && v < 10000 ? v : 1;
}

// ---------- mandate form ----------

export interface MandateInput {
  label: string;
  line: string;
  side: string;
  targetSide: string;
  lines: string[];
  countries: string;
  mwMin: string;
  mwMax: string;
  amountMin: string;
  amountMax: string;
  keywords: string;
  notes: string;
}

function num(v: string): number | null | "bad" {
  const s = (v ?? "").replace(/[,£$\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : "bad";
}

/** Turns the friendly mandate form into the criteria the engine reads, or a plain-English problem. */
export function buildCriteria(m: MandateInput): { criteria: Record<string, unknown> } | { error: string } {
  if (!m.label.trim()) return { error: "Please give the mandate a name." };
  if (!isLine(m.line)) return { error: "Please choose a line." };
  if (m.side !== "supply" && m.side !== "need") return { error: "Please say whether they have something (supply) or need something." };
  if (m.targetSide !== "supply" && m.targetSide !== "need") return { error: "Please say what they are looking for." };
  const countries = Array.from(new Set(m.countries.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean)));
  const bad = countries.filter((c) => !/^[A-Z]{2}$/.test(c));
  if (bad.length) return { error: `Countries must be two-letter codes like GB, US, AE. Not understood: ${bad.join(", ")}` };
  const mwMin = num(m.mwMin), mwMax = num(m.mwMax), amtMin = num(m.amountMin), amtMax = num(m.amountMax);
  if ([mwMin, mwMax, amtMin, amtMax].includes("bad")) return { error: "Sizes and amounts must be numbers (or left blank)." };
  if (mwMin !== null && mwMax !== null && (mwMin as number) > (mwMax as number)) return { error: "Minimum MW is larger than maximum MW." };
  if (amtMin !== null && amtMax !== null && (amtMin as number) > (amtMax as number)) return { error: "Minimum amount is larger than maximum amount." };
  const lines = m.lines.filter((l) => isLine(l));
  const keywords = Array.from(new Set(m.keywords.split(",").map((k) => k.trim()).filter(Boolean))).slice(0, 50);
  const notes = m.notes.trim().slice(0, 4000);
  const criteria: Record<string, unknown> = { lines: lines.length ? lines : [m.line], target_side: m.targetSide };
  if (countries.length) criteria.countries = countries;
  if (mwMin !== null) criteria.mw_min = mwMin;
  if (mwMax !== null) criteria.mw_max = mwMax;
  if (amtMin !== null) criteria.amount_min_usd = amtMin;
  if (amtMax !== null) criteria.amount_max_usd = amtMax;
  if (keywords.length) criteria.keywords = keywords;
  if (notes) criteria.notes = notes;
  return { criteria };
}

/** One line per criterion, in plain English, for the mandate list. */
export function criteriaSummary(c: Record<string, unknown>, lineLabel: (l: string) => string): string[] {
  const out: string[] = [];
  const n = (v: unknown) => new Intl.NumberFormat("en-GB").format(Number(v));
  const lines = Array.isArray(c.lines) ? (c.lines as string[]).map(lineLabel) : [];
  if (lines.length) out.push(`Sees: ${lines.join(", ")}`);
  if (c.target_side) out.push(`Looking for: ${c.target_side === "supply" ? "things on offer" : "people who need something"}`);
  if (Array.isArray(c.countries) && c.countries.length) out.push(`Countries: ${(c.countries as string[]).join(", ")}`);
  if (c.mw_min != null || c.mw_max != null) out.push(`Size: ${c.mw_min ?? 0}–${c.mw_max ?? "any"} MW`);
  if (c.amount_min_usd != null || c.amount_max_usd != null)
    out.push(`Amount: $${c.amount_min_usd != null ? n(c.amount_min_usd) : "0"}–${c.amount_max_usd != null ? `$${n(c.amount_max_usd)}` : "any"}`);
  if (Array.isArray(c.keywords) && c.keywords.length) out.push(`Keywords: ${(c.keywords as string[]).join(", ")}`);
  if (typeof c.notes === "string" && c.notes) out.push(`Notes: ${c.notes}`);
  return out;
}
