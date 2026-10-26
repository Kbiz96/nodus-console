// The front page's "Today" block: the morning brief (daily_briefs, written 06:40 UK on weekdays), the Do now
// list merged with live items, and the Background BD pipeline strip. Pure functions only, so they can be unit-tested.

export interface BriefCall { time: string; who: string; goal: string }
export interface BriefItem { text: string; link: string | null }
export interface BriefMandate { rank: number | null; title: string; status: string; next: string; overdue: boolean }
export interface Brief {
  day: string | null;
  headline: string;
  calls: BriefCall[];
  do_now: BriefItem[];
  could_do: string[];
  mandates: BriefMandate[];
  digest: string[];
  rep: { q: string; a: string } | null;
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
  return { day, headline: str(o.headline), calls, do_now, could_do, mandates, digest, rep };
}

/** True when there is nothing worth showing (an empty row is treated as no brief). */
export function briefIsEmpty(b: Brief | null): boolean {
  return !b || (!b.headline && b.calls.length === 0 && b.do_now.length === 0 && b.could_do.length === 0 && b.digest.length === 0 && !b.rep);
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
  /** Drafts and LinkedIn messages waiting in Review. */
  drafts: number;
  /** Replies that need an answer. */
  replies: number;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}

/**
 * Live items from the database. Replies and drafts are urgent (someone is waiting, or a send slot is coming);
 * new leads are routine and only take a slot the brief does not need.
 */
export function liveItems(c: LiveCounts): DoItem[] {
  const out: DoItem[] = [];
  if (c.replies > 0) {
    out.push({ key: "live-replies", text: `Answer ${plural(c.replies, "reply", "replies")}`, detail: "Someone wrote back. Claude drafts the answer.", cta: "Answer", action: { kind: "scroll", target: "waiting" }, live: true, urgent: true });
  }
  if (c.drafts > 0) {
    out.push({ key: "live-drafts", text: `Approve ${plural(c.drafts, "draft", "drafts")}`, detail: "Approved emails go out at the next send slot.", cta: "Review", action: { kind: "route", to: "/review" }, live: true, urgent: true });
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
      action: { kind: "scroll", target: c.mandateLeads > 0 ? "signed-mandates" : "bd" },
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
  if (/^https?:\/\//.test(link)) return { action: { kind: "href", href: link }, cta: "Open" };
  return { action: { kind: "claude", prompt: `Nodus command: ${item.text.replace(/[.\s]+$/, "")}.` }, cta: "Do it with Claude" };
}

export function briefItems(items: BriefItem[]): DoItem[] {
  return items.map((d, i) => ({ key: `brief-${i}`, text: d.text, ...briefAction(d), live: false, urgent: false }));
}

export const DO_NOW_MAX = 3;

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
