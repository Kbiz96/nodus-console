// The front page's "Today" block: the morning brief (daily_briefs, written 06:40 UK on weekdays), the Do now
// list merged with live items, and the Background BD pipeline strip. Pure functions only, so they can be unit-tested.

import { isGmailUrl, sendStatusText, type SendState } from "./today.ts";

export interface BriefCall { time: string; who: string; goal: string }
export interface BriefItem { text: string; link: string | null }
export interface BriefMandate { rank: number | null; title: string; status: string; next: string; overdue: boolean }
/** A reply someone is owed, found by the 06:40 and 17:45 runs; the answer is already a Gmail draft when the link is set. */
export interface BriefReply { who: string; company: string; summary: string; gmail_draft_url: string | null }
export interface Brief {
  day: string | null;
  headline: string;
  calls: BriefCall[];
  do_now: BriefItem[];
  could_do: string[];
  mandates: BriefMandate[];
  digest: string[];
  rep: { q: string; a: string } | null;
  replies: BriefReply[];
  /** The brief's old send flag (from when sending was scheduled); kept for older briefs, no longer shown. */
  send_enabled: boolean | null;
}

function str(v: unknown): string {
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** A brief body from the database, every field optional and any shape tolerated. Never throws. */
export function parseBrief(body: unknown, day: string | null = null): Brief {
  let b: unknown = body;
  if (typeof b === "string") {
    try { b = JSON.parse(b); } catch { b = {}; }
  }
  const o = obj(b);
  const calls = arr(o.calls)
    .map((c) => (typeof c === "string" ? { time: "", who: str(c), goal: "" } : { time: str(obj(c).time), who: str(obj(c).who), goal: str(obj(c).goal) }))
    .filter((c) => c.who || c.goal);
  const do_now = arr(o.do_now)
    .map((d) => (typeof d === "string" ? { text: str(d), link: null } : { text: str(obj(d).text), link: str(obj(d).link) || null }))
    .filter((d) => d.text);
  const could_do = arr(o.could_do).map((c) => (typeof c === "object" ? str(obj(c).text) : str(c))).filter(Boolean);
  const mandates = arr(o.mandates)
    .map((m) => {
      const x = obj(m);
      const rank = Number(x.rank);
      return { rank: Number.isFinite(rank) && x.rank !== null && x.rank !== "" ? rank : null, title: str(x.title), status: str(x.status), next: str(x.next), overdue: x.overdue === true };
    })
    .filter((m) => m.title);
  const digest = arr(o.digest).map(str).filter(Boolean).slice(0, 4);
  const r = obj(o.rep);
  const rep = str(r.q) ? { q: str(r.q), a: str(r.a) } : null;
  const replies = arr(o.replies)
    .map((x) => {
      const y = obj(x);
      const url = str(y.gmail_draft_url);
      return { who: str(y.who), company: str(y.company), summary: str(y.summary), gmail_draft_url: /^https:\/\/mail\.google\.com\//.test(url) ? url : null };
    })
    .filter((x) => x.who || x.company);
  const send_enabled = o.send_enabled === true ? true : o.send_enabled === false ? false : null;
  return { day, headline: str(o.headline), calls, do_now, could_do, mandates, digest, rep, replies, send_enabled };
}

/** True when there is nothing worth showing (an empty row is treated as no brief). */
export function briefIsEmpty(b: Brief | null): boolean {
  return !b || (!b.headline && b.calls.length === 0 && b.do_now.length === 0 && b.could_do.length === 0 && b.digest.length === 0 && !b.rep && b.replies.length === 0 && b.send_enabled === null);
}

// ---------- when the brief is missing ----------

const ukClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** What to say when today's brief is not in: weekends have none; on weekdays it lands at 06:40 UK. */
export function briefMissingNote(now = new Date()): string {
  const p: Record<string, string> = {};
  for (const { type, value } of ukClock.formatToParts(now)) p[type] = value;
  if (p.weekday === "Sat" || p.weekday === "Sun") return "No brief at weekends. Live items are below.";
  const mins = Number(p.hour) * 60 + Number(p.minute);
  return mins < 6 * 60 + 40 ? "Today’s brief arrives at 06:40." : "Today’s brief arrives at 06:40. It isn’t in yet.";
}

// ---------- Do now ----------

export type DoAction =
  | { kind: "route"; to: string }
  | { kind: "href"; href: string }
  | { kind: "scroll"; target: string }
  | { kind: "claude"; prompt: string };

export interface DoItem {
  key: string;
  text: string;
  detail?: string;
  cta: string;
  action: DoAction;
  live: boolean;
  urgent: boolean;
}

export interface LiveCounts {
  /** New leads on signed mandates. */
  mandateLeads: number;
  /** New Background BD leads (no priority). */
  backgroundLeads: number;
  /** Email drafts waiting for approval (what the Approve deck shows). */
  drafts: number;
  /** Replies that need an answer. */
  replies: number;
  /** When the last email went out within the last weekday day; null when none did or unknown. */
  lastSentAt?: string | null;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}

/**
 * Live items from the database. Replies and drafts are urgent (someone is waiting, or a send slot is coming);
 * new leads are routine and only take a slot the brief does not need.
 */
export function liveItems(c: LiveCounts, send: SendState | null = null): DoItem[] {
  const out: DoItem[] = [];
  if (c.replies > 0) {
    out.push({ key: "live-replies", text: `Answer ${plural(c.replies, "reply", "replies")}`, detail: "Someone wrote back.", cta: "See replies", action: { kind: "scroll", target: "replies" }, live: true, urgent: true });
  }
  if (c.drafts > 0) {
    out.push({ key: "live-drafts", text: `Approve ${plural(c.drafts, "draft", "drafts")}`, detail: sendStatusText(send), cta: "Review and send", action: { kind: "scroll", target: "approve" }, live: true, urgent: true });
  }
  const leads = c.mandateLeads + c.backgroundLeads;
  if (leads > 0) {
    const parts = [
      c.mandateLeads ? `${c.mandateLeads.toLocaleString("en-GB")} on signed mandates` : "",
      c.backgroundLeads ? `${c.backgroundLeads.toLocaleString("en-GB")} from background BD` : "",
    ].filter(Boolean);
    out.push({
      key: "live-leads",
      text: `Approve or dismiss ${plural(leads, "new lead", "new leads")}`,
      detail: parts.join(", ") + ".",
      cta: "Go to leads",
      action: { kind: "route", to: "/leads" },
      live: true,
      urgent: false,
    });
  }
  return out;
}

/** Where a brief item's link goes: a page in the console, an outside link, or (no link) a Claude chat. */
export function briefAction(item: BriefItem): { action: DoAction; cta: string } {
  const link = (item.link ?? "").trim();
  if (/^#?\/(?!\/)/.test(link)) return { action: { kind: "route", to: link.replace(/^#/, "") }, cta: "Open" };
  if (/^https:\/\/claude\.ai\//.test(link)) return { action: { kind: "href", href: link }, cta: "Open in Claude" };
  if (isGmailUrl(link)) return { action: { kind: "href", href: link }, cta: "Open draft in Gmail" };
  if (/^https?:\/\//.test(link)) return { action: { kind: "href", href: link }, cta: "Open" };
  return { action: { kind: "claude", prompt: `Nodus command: ${item.text.replace(/[.\s]+$/, "")}.` }, cta: "Do it with Claude" };
}

/** Links the brief writes that point nowhere useful: the front page itself, or the old Review queue. */
const VAGUE_LINK = /^#?\/?(review)?\/?$/i;

/** The console place a brief item is about, judged from its words; null when it is not recognisable. */
export function briefRoute(text: string): DoAction | null {
  const t = text.toLowerCase();
  if (/\b(drafts?|review queue|approve)\b/.test(t) && !/\bleads?\b/.test(t)) return { kind: "scroll", target: "approve" };
  if (/\bleads?\b/.test(t) && /\b(approve|dismiss|new)\b/.test(t)) return { kind: "route", to: "/leads" };
  if (/^(reply|answer|respond)\b|\brepl(y|ies) to\b/.test(t)) return { kind: "scroll", target: "replies" };
  if (/\b(chase|nudge|follow[- ]?up|call\b.*\bback)\b/.test(t)) return { kind: "route", to: "/pipeline" };
  if (/\bmatch(es)?\b/.test(t)) return { kind: "route", to: "/engine" };
  if (/\bmandate card\b/.test(t)) return { kind: "route", to: "/mandates" };
  return null;
}

const CTA: Record<string, string> = { approve: "Approve", replies: "See replies", "/leads": "Go to leads", "/pipeline": "Open pipeline", "/engine": "Open board", "/mandates": "Open mandates" };

/**
 * The brief is written at 06:40; counts in it go stale as Kuran works. Swap "57 drafts waiting" for the live
 * number (or drop the number when it is not known) and drop the "incl. 20 X and 30 Y" breakdown that went with it.
 */
export function freshText(text: string, live: Partial<LiveCounts> | null = null): string {
  let t = text;
  if (/\bdrafts?\b/i.test(t)) {
    const n = live?.drafts;
    t = t.replace(/\b\d[\d,]*\s+(email\s+)?drafts?(\s+waiting)?/i, (_m, _e, w) =>
      typeof n === "number" ? `${n.toLocaleString("en-GB")} ${n === 1 ? "draft" : "drafts"}${w ?? ""}` : `drafts${w ?? ""}`);
    t = t.replace(/,?\s*\(?incl(\.|uding)\s[^.)]*\d[^.)]*\)?/i, "");
  }
  if (/\bnew leads?\b/i.test(t) && live && typeof live.mandateLeads === "number" && typeof live.backgroundLeads === "number") {
    const n = live.mandateLeads + live.backgroundLeads;
    t = t.replace(/\b\d[\d,]*\s+new leads?\b/i, `${n.toLocaleString("en-GB")} new ${n === 1 ? "lead" : "leads"}`);
  }
  return t.replace(/\s+([.,;:])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

/** One brief item, with vague links ("#/", "#/review") routed to the right console place and stale counts refreshed. */
export function briefItem(d: BriefItem, i: number, live: Partial<LiveCounts> | null = null): DoItem {
  const link = (d.link ?? "").trim();
  const text = freshText(d.text, live);
  if (link && VAGUE_LINK.test(link)) {
    const to = briefRoute(d.text);
    if (to) {
      const k = to.kind === "scroll" ? to.target : to.kind === "route" ? to.to : "";
      return { key: `brief-${i}`, text, action: to, cta: CTA[k] ?? "Open", live: false, urgent: false };
    }
    // A vague console link that matches nothing: better a Claude hand-off than a button to the page you are on.
    return { key: `brief-${i}`, text, ...briefAction({ text, link: null }), live: false, urgent: false };
  }
  return { key: `brief-${i}`, text, ...briefAction({ text, link: d.link }), live: false, urgent: false };
}

export function briefItems(items: BriefItem[], live: Partial<LiveCounts> | null = null): DoItem[] {
  return items.map((d, i) => briefItem(d, i, live));
}

export const DO_NOW_MAX = 3;

/**
 * The focus session on Today: the brief's own Do now (three at most; the rest go to Could do). With no brief items,
 * the live items stand in so the session is never empty while something is waiting.
 */
export function focusSession(brief: DoItem[], live: DoItem[], max = DO_NOW_MAX): { now: DoItem[]; overflow: DoItem[] } {
  if (brief.length > 0) return { now: brief.slice(0, max), overflow: brief.slice(max) };
  return { now: live.slice(0, max), overflow: live.slice(max) };
}

/** One Claude chat for every focus item that has no link of its own (instead of a chat per item). */
export function sessionPrompt(items: Pick<DoItem, "text">[]): string {
  const list = items.map((d, i) => `${i + 1}. ${d.text.replace(/\s+/g, " ").trim()}`).join("\n");
  return (
    `Nodus command: focus session. Do these ${items.length === 1 ? "one" : items.length} for me in order, ` +
    "as far as you can without sending anything: drafts go into Gmail as drafts (in the existing thread when there is one) " +
    `or into the console for my approval. Tell me what is left for me after each.\n${list}`
  );
}

/**
 * At most three Do now items. Urgent live items go first, but the brief's top item always keeps a slot when there
 * is one; then the rest of the brief; then routine live items. Whatever does not fit moves to the top of Could do.
 */
export function mergeDoNow(brief: DoItem[], live: DoItem[], max = DO_NOW_MAX): { now: DoItem[]; overflow: DoItem[] } {
  const urgent = live.filter((l) => l.urgent);
  const routine = live.filter((l) => !l.urgent);
  const urgentFirst = urgent.slice(0, brief.length > 0 ? Math.max(0, max - 1) : max);
  const ordered = [...urgentFirst, ...brief, ...urgent.slice(urgentFirst.length), ...routine];
  return { now: ordered.slice(0, max), overflow: ordered.slice(max) };
}

export const COULD_DO_MAX = 5;

/** Could do: overflow from Do now first, then the brief's list, at most five. */
export function couldDo(overflow: DoItem[], brief: string[], max = COULD_DO_MAX): { key: string; text: string; item: DoItem | null }[] {
  return [
    ...overflow.map((o) => ({ key: o.key, text: o.text, item: o as DoItem | null })),
    ...brief.map((t, i) => ({ key: `could-${i}`, text: t, item: null })),
  ].slice(0, max);
}

// ---------- Background BD pipeline ----------

export const BD_PER_EVENING = 15;
export const BD_PROCESS_NOW = 25;

export interface PipelineCounts {
  /** bd_queue tier A: routed to a signed mandate. */
  routed: number | null;
  /** bd_queue tier B: background. */
  background: number | null;
  /** Background leads waiting for approve or dismiss. */
  waiting?: number | null;
}

/** The one-line strip above the Background BD queue. Unknown counts are left out rather than shown as zero. */
export function pipelineStrip(c: PipelineCounts, perEvening = BD_PER_EVENING): { n: string; label: string }[] {
  const f = (n: number) => n.toLocaleString("en-GB");
  const out: { n: string; label: string }[] = [];
  if (c.routed !== null && c.routed !== undefined) out.push({ n: f(c.routed), label: "routed to mandates" });
  if (c.background !== null && c.background !== undefined) out.push({ n: f(c.background), label: "in background queue" });
  if (c.waiting) out.push({ n: f(c.waiting), label: c.waiting === 1 ? "lead waiting for you" : "leads waiting for you" });
  out.push({ n: f(perEvening), label: "processed each evening" });
  return out;
}

/** "Process 25 now": one Claude chat that turns the next 25 bd_queue rows into named leads. */
export function processNowPrompt(n = BD_PROCESS_NOW): string {
  return (
    `Nodus command: run background BD now. Take the next ${n} from bd_queue (order by tier, bd_score desc), find the 1–2 best ` +
    "decision makers at each organisation with Apollo people search (free; no email reveals), skip anyone already in the CRM, " +
    "lead_candidates or dismissals, and insert them into lead_candidates (priority_id = suggested_priority_id, source 'engine', " +
    "source_ref, opportunity_id, hook = opportunity title, hook_url = evidence_url, fit_score = bd_score, fit_reason). " +
    "Report how many were queued per mandate."
  );
}

const LINE_CHIP: Record<string, string> = { capital: "Capital", powered_land: "Powered land", compute: "Compute", critical_power: "Critical power" };

/** Short chip label for an engine line. */
export function lineChip(line: string | null | undefined): string | null {
  if (!line) return null;
  return LINE_CHIP[line] ?? line.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
