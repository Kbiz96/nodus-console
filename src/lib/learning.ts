// Learning library: Kuran's old Nodus Daily lessons, course modules and learning docs (table learning_lessons,
// engine migration 0030). Untimed reference reading: no schedules, countdowns or scores.
// The list loads only the light columns; a lesson's full `data` loads when it is opened and is kept in memory.
import { supabase, must } from "./supabase.ts";

export const LEARNING_LIST_COLS = "id,lesson_date,slot,pillar,module,title,summary,kind";

export interface LearningRow {
  id: string;
  lesson_date: string | null;
  slot: string | null;
  pillar: string | null;
  module: string | null;
  title: string;
  summary: string | null;
  kind: string;
}

export interface QuizQ { q: string; o: string[]; a: number; why?: string; concept?: string }
export interface LearningData {
  sections?: { h?: string; body?: string }[];
  nodus?: { ask?: string; line?: string; redflag?: string; signal?: string };
  quiz?: QuizQ[];
  drill?: { kind?: string; prompt?: string; model?: string };
  story?: { headline?: string; url?: string; source?: string; published?: string };
  sources?: { t?: string; u?: string }[];
  minutes?: number;
  // course modules
  lessons?: { t: string; h: string }[];
  exam?: QuizQ[];
  track?: string;
  order?: number;
  // docs
  markdown?: string;
}

export const PILLAR_LABEL: Record<string, string> = {
  A: "A · Data-centre economics",
  B: "B · The business of data centres",
  C: "C · Investors and capital",
  D: "D · Procurement",
  E: "E · Executive communication",
  Capstone: "Capstone",
};
const PILLAR_ORDER = ["A", "B", "C", "D", "E", "Capstone"];

export function pillarLabel(p: string | null): string {
  return p ? PILLAR_LABEL[p] ?? p : "Other";
}

export const KIND_LABEL: Record<string, string> = { lesson: "Lesson", course: "Course module", doc: "Document" };

export async function learningList(): Promise<LearningRow[]> {
  return must(
    await supabase.from("learning_lessons").select(LEARNING_LIST_COLS)
      .order("lesson_date", { ascending: false, nullsFirst: false }).order("id").limit(1000),
  ) as unknown as LearningRow[];
}

const full = new Map<string, LearningData>();
/** One lesson's full content, fetched once per session. */
export async function learningData(id: string): Promise<LearningData> {
  const hit = full.get(id);
  if (hit) return hit;
  const rows = must(await supabase.from("learning_lessons").select("data").eq("id", id).limit(1)) as unknown as { data: LearningData | null }[];
  const d = (rows[0]?.data ?? {}) as LearningData;
  full.set(id, d);
  return d;
}

/** Rows whose title, summary or module contain every word of the search. */
export function searchRows(rows: LearningRow[], q: string): LearningRow[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => {
    const hay = `${r.title} ${r.summary ?? ""} ${r.module ?? ""} ${pillarLabel(r.pillar)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

function byNewest(a: LearningRow, b: LearningRow): number {
  const da = a.lesson_date ?? "", db = b.lesson_date ?? "";
  if (da !== db) return da < db ? 1 : -1;
  return (a.slot ?? a.id) < (b.slot ?? b.id) ? 1 : -1;
}

export interface LearningGroup { key: string; label: string; rows: LearningRow[] }

/**
 * Newest first: dated lessons by month, then course modules and documents. By module: grouped by pillar, then
 * module name, alphabetically within a pillar.
 */
export function groupRows(rows: LearningRow[], sort: "newest" | "module"): LearningGroup[] {
  const groups = new Map<string, LearningGroup>();
  const add = (key: string, label: string, r: LearningRow) => {
    const g = groups.get(key) ?? { key, label, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  };
  if (sort === "newest") {
    for (const r of [...rows].sort(byNewest)) {
      if (r.lesson_date) {
        const [y, m] = r.lesson_date.split("-");
        const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
        add(`d-${y}-${m}`, `Lessons · ${label}`, r);
      } else {
        add(`k-${r.kind}`, r.kind === "course" ? "Course modules" : r.kind === "doc" ? "Documents" : "Undated", r);
      }
    }
    return [...groups.values()];
  }
  const sorted = [...rows].sort((a, b) => {
    const pa = PILLAR_ORDER.indexOf(a.pillar ?? ""), pb = PILLAR_ORDER.indexOf(b.pillar ?? "");
    if (pa !== pb) return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
    const ma = a.module ?? "", mb = b.module ?? "";
    if (ma !== mb) return ma.localeCompare(mb);
    return byNewest(a, b);
  });
  for (const r of sorted) add(`p-${r.pillar ?? "other"}`, pillarLabel(r.pillar), r);
  return [...groups.values()];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function inline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  out = out.replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

/** A small Markdown subset (headings, lists, tables, quotes, bold, italics, code, https links) to HTML. Text is escaped first; the result still goes through sanitiseHtml. */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { const n = Math.min(6, h[1].length + 2); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(`<div class="tbl"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, "").replace(/^\[( |x)\]\s*/i, ""));
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
      continue;
    }
    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote><p>${inline(buf.join(" "))}</p></blockquote>`);
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*\||\s*([-*+]|\d+[.)])\s+|>)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

const ALLOWED_TAGS = new Set(["P", "UL", "OL", "LI", "B", "STRONG", "I", "EM", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "BR", "DIV", "SPAN", "A", "H3", "H4", "H5", "H6", "CODE", "PRE", "DL", "DT", "DD", "SMALL", "SUP", "SUB", "BLOCKQUOTE", "HR"]);
const DROP_WITH_CONTENT = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "NOSCRIPT", "SVG", "MATH", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "LINK", "META"]);
const SAFE_CLASS = /^[A-Za-z0-9 _-]{0,80}$/;

/**
 * Allow-list sanitiser for lesson HTML (browser only). Unknown tags become their text; scripts, styles and
 * embeds are dropped with their content; the only attributes kept are a plain class, OL start, colspan/rowspan,
 * and https links (opened in a new tab).
 */
export function sanitiseHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html || ""}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";
  const walk = (n: Element) => {
    for (const c of Array.from(n.children)) {
      if (DROP_WITH_CONTENT.has(c.tagName)) { c.remove(); continue; }
      if (!ALLOWED_TAGS.has(c.tagName)) { c.replaceWith(doc.createTextNode(c.textContent ?? "")); continue; }
      for (const a of Array.from(c.attributes)) {
        const k = a.name.toLowerCase();
        if (k === "class" && SAFE_CLASS.test(a.value)) continue;
        if (k === "start" && c.tagName === "OL" && /^\d+$/.test(a.value)) continue;
        if ((k === "colspan" || k === "rowspan") && /^\d{1,2}$/.test(a.value)) continue;
        if (k === "href" && c.tagName === "A" && /^https:\/\//i.test(a.value.trim())) continue;
        c.removeAttribute(a.name);
      }
      if (c.tagName === "A") {
        if (c.hasAttribute("href")) { c.setAttribute("target", "_blank"); c.setAttribute("rel", "noopener noreferrer"); }
      }
      walk(c);
    }
  };
  walk(root);
  return root.innerHTML;
}

export function isHttps(u: string | undefined | null): u is string {
  return !!u && /^https:\/\//i.test(u.trim());
}
