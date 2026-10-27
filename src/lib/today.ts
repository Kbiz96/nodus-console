// Rules behind the three main screens (Today, Pipeline, Engine): the honest sending line, which LinkedIn messages
// can be sent now, and the "stalled first" pipeline. Pure functions only, so they can be unit-tested.

import { CLOSED_STAGES, fmtDay, isOverdue, ukToday } from "./crm.ts";
import { isLinkedIn } from "./focus.ts";
import type { CrmContact, Deal, Outreach } from "./types.ts";

// ---------- sending ----------

export const SEND_ON_TEXT = "Approved emails go out at 09:53, 12:53 and 15:53.";
export const SEND_IDLE_TEXT = "No emails sent in the last day.";

const ukWeekday = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" });
const isWeekend = (d: Date) => ["Sat", "Sun"].includes(ukWeekday.format(d));

/**
 * Where "the last day" starts: 24 hours back, stretched over any weekend (the send batch runs on weekdays only),
 * so on a Monday morning Friday's sends still count.
 */
export function sendWindowStart(now = new Date()): Date {
  let t = now.getTime() - 24 * 3600e3;
  for (let i = 0; i < 3 && isWeekend(new Date(t)); i++) t -= 24 * 3600e3;
  return new Date(t);
}

/** Sending is live when an email actually went out (status sent, sent_at set) in the last weekday day. Read from data, never from a flag. */
export function isSendLive(sentAts: (string | null | undefined)[], now = new Date()): boolean {
  const from = sendWindowStart(now).getTime();
  return sentAts.some((s) => {
    const t = s ? Date.parse(s) : NaN;
    return Number.isFinite(t) && t >= from && t <= now.getTime() + 60e3 && !isWeekend(new Date(t));
  });
}

/** True only when sending is known to be live. Unknown counts as not live: the console never claims a send it cannot vouch for. */
export function isSendOn(v: unknown): boolean {
  return v === true;
}

/** The one line that says whether approved emails are going out, judged from what was actually sent. */
export function sendStatusText(v: unknown): string {
  return isSendOn(v) ? SEND_ON_TEXT : SEND_IDLE_TEXT;
}

/** What Approve says afterwards. */
export function approvedText(name: string | null, v: unknown, slotLabel: string): string {
  const who = name || "the email";
  return isSendOn(v) ? `Approved ${who}. Sends at ${slotLabel}.` : `Approved ${who}. Queued for the next send batch.`;
}

export function isGmailUrl(url: string | null | undefined): boolean {
  return /^https:\/\/mail\.google\.com\//.test((url ?? "").trim());
}

/** A Gmail search for someone's thread, for replies that have no draft link yet. */
export function gmailSearchUrl(q: string): string {
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(q)}`;
}

/** A Google Calendar "new event" link with the title (and details) filled in; Kuran picks the time. */
export function calendarUrl(title: string, details = ""): string {
  const p = new URLSearchParams({ action: "TEMPLATE", text: title });
  if (details) p.set("details", details);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

// ---------- LinkedIn: connected or not ----------

export const NOTE_LEAD = "If not connected, send this note first:";

/** The research note says so ("CONNECTED", but not "NOT CONNECTED"), or the CRM contact's notes say "LinkedIn connected". */
export function isConnected(note: string | null | undefined, contactNotes: string | null | undefined): boolean {
  const n = note ?? "";
  if (/(^|[^A-Z])CONNECTED\b/.test(n.replace(/\bNOT\s+CONNECTED\b/g, ""))) return true;
  const c = (contactNotes ?? "").replace(/\bnot\s+linkedin\s+connected\b/gi, "");
  return /\blinkedin connected\b/i.test(c);
}

/** The connection note to send first: the text after "If not connected, send this note first:", or a connect row's own text. */
export function connectionNote(o: Pick<Outreach, "note" | "kind" | "body">): string | null {
  const note = o.note ?? "";
  const at = note.indexOf(NOTE_LEAD);
  if (at >= 0) {
    const rest = note.slice(at + NOTE_LEAD.length).split(/\n\s*\n/)[0].trim().replace(/^["“']|["”']$/g, "").trim();
    if (rest) return rest;
  }
  if (o.kind === "connect" && (o.body ?? "").trim()) return (o.body ?? "").trim();
  return null;
}

type LiRow = Pick<Outreach, "channel" | "kind" | "note" | "contact_id">;

/**
 * LinkedIn messages to people (DMs and connection requests; not comments or posts), split into those Kuran can send
 * now (already connected) and those waiting for a connection.
 */
export function splitLinkedIn<T extends LiRow>(rows: T[], contactNotes: Map<string, string | null>): { ready: T[]; waiting: T[] } {
  const ready: T[] = [];
  const waiting: T[] = [];
  for (const r of rows) {
    if (!isLinkedIn(r) || r.kind === "comment" || r.kind === "post") continue;
    const cn = r.contact_id ? contactNotes.get(r.contact_id) ?? null : null;
    if (r.kind !== "connect" && isConnected(r.note, cn)) ready.push(r);
    else waiting.push(r);
  }
  return { ready, waiting };
}

// ---------- Pipeline: stalled first ----------

export const WARM_STAGES = ["Replied", "Meeting", "Qualified", "NCNDA"] as const;

export interface PipeRow {
  kind: "deal" | "contact";
  id: string;
  who: string;
  company: string | null;
  what: string;
  next: string;
  due: string | null;
  /** Whole days past the due date; null when there is no date. */
  overdue: number | null;
  stalled: boolean;
  stage: string | null;
  email: string | null;
}

/** Days from `from` to `to`, both "YYYY-MM-DD". */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400e3);
}

type PDeal = Pick<Deal, "id" | "deal" | "counterparty" | "stage" | "next_step" | "next_date" | "contact_id">;
type PContact = Pick<CrmContact, "id" | "name" | "company" | "stage" | "next_follow_up" | "email" | "last_activity">;

/**
 * Open deals and warm contacts in one list. Stalled: a deal whose next date is today or past; a warm contact
 * (Replied, Meeting, Qualified, NCNDA) whose follow-up is past or not set. Stalled come first, most overdue first,
 * then the ones with no date; everything else follows, soonest first.
 */
export function pipelineRows(deals: PDeal[], contacts: PContact[], today = ukToday(), behindDeals: PContact[] = []): PipeRow[] {
  const people = new Map([...behindDeals, ...contacts].map((c) => [c.id, c]));
  const rows: PipeRow[] = [];
  for (const d of deals) {
    if (CLOSED_STAGES.includes(d.stage ?? "")) continue;
    const c = d.contact_id ? people.get(d.contact_id) : undefined;
    const due = d.next_date ?? null;
    const stalled = Boolean(due && due <= today);
    rows.push({
      kind: "deal",
      id: d.id,
      who: c?.name || d.counterparty || d.deal || "Unnamed deal",
      company: c?.company ?? (c?.name ? d.counterparty : null) ?? null,
      what: d.deal || "Deal",
      next: (d.next_step ?? "").replace(/\s+/g, " ").trim() || "Agree the next step",
      due,
      overdue: due ? Math.max(0, daysBetween(due, today)) : null,
      stalled,
      stage: d.stage ?? null,
      email: c?.email ?? null,
    });
  }
  for (const c of contacts) {
    if (!(WARM_STAGES as readonly string[]).includes(c.stage ?? "")) continue;
    const due = c.next_follow_up ?? null;
    rows.push({
      kind: "contact",
      id: c.id,
      who: c.name || "Unnamed contact",
      company: c.company ?? null,
      what: `${c.stage} contact`,
      next: c.last_activity ? `Follow up (last touch ${fmtDay(c.last_activity)})` : due ? "Follow up" : "No follow-up set",
      due,
      overdue: due ? Math.max(0, daysBetween(due, today)) : null,
      stalled: !due || isOverdue(due, today),
      stage: c.stage ?? null,
      email: c.email ?? null,
    });
  }
  const rank = (r: PipeRow) => (r.stalled ? (r.due ? 0 : 1) : 2);
  return rows.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return (b.overdue ?? 0) - (a.overdue ?? 0) || a.who.localeCompare(b.who);
    if (ra === 1) return a.who.localeCompare(b.who);
    return (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.who.localeCompare(b.who);
  });
}

/** How late, in plain words. */
export function overdueLabel(r: Pick<PipeRow, "stalled" | "overdue" | "due">): string {
  if (!r.due) return r.stalled ? "No date set" : "";
  if (r.overdue === null || r.overdue <= 0) return r.stalled ? "Due today" : "";
  return r.overdue === 1 ? "1 day overdue" : `${r.overdue} days overdue`;
}

/** The one Claude hand-off on Pipeline: draft the nudge as a Gmail draft in the existing thread. */
export function nudgePrompt(r: PipeRow): string {
  const who = [r.who, r.company && r.company !== r.who ? `at ${r.company}` : ""].filter(Boolean).join(" ");
  const mail = r.email ? ` (${r.email})` : "";
  const late = r.due ? (r.overdue && r.overdue > 0 ? `${r.overdue} days overdue (was due ${r.due})` : `due ${r.due}`) : "with no follow-up date";
  const about = r.kind === "deal" ? `the deal "${r.what}", next step "${r.next}"` : `our conversation (stage ${r.stage ?? "unknown"})`;
  return (
    `Nodus command: draft the nudge to ${who}${mail} about ${about}. It is ${late}. ` +
    "Find my latest Gmail thread with them and read it. Write a short, specific nudge that asks for the one thing we need next, " +
    "with my booking link or two specific slots. Save it as a Gmail draft in that same thread (do not send). " +
    `Log it in crm_actions, set the ${r.kind === "deal" ? "deal's next_date" : "contact's next_follow_up"} to 4 working days from today, and give me the draft link.`
  );
}

// ---------- Replies owed ----------

export interface OwedRow {
  key: string;
  who: string;
  company: string | null;
  summary: string;
  /** The ready Gmail draft, or a Gmail search for the thread when no draft link is known. */
  url: string;
  ready: boolean;
}

type BriefReplyLike = { who: string; company: string; summary: string; gmail_draft_url: string | null };
type RepliedRow = Pick<Outreach, "id" | "to_name" | "to_email" | "company" | "subject" | "replied_at">;

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Replies owed: the brief's list first (each with its Gmail draft), then replies logged in outreach that the brief
 * does not mention (same person or company), each with a Gmail search for the thread.
 */
export function repliesOwed(brief: BriefReplyLike[], logged: RepliedRow[]): OwedRow[] {
  const out: OwedRow[] = brief.map((r, i) => ({
    key: `brief-${i}`,
    who: r.who || r.company,
    company: r.who ? r.company || null : null,
    summary: r.summary,
    url: r.gmail_draft_url ?? gmailSearchUrl([r.who, r.company].filter(Boolean).join(" ")),
    ready: Boolean(r.gmail_draft_url),
  }));
  const names = new Set(brief.map((r) => norm(r.who)).filter(Boolean));
  const firms = new Set(brief.map((r) => norm(r.company)).filter(Boolean));
  for (const o of logged) {
    if ((o.to_name && names.has(norm(o.to_name))) || (o.company && firms.has(norm(o.company)))) continue;
    out.push({
      key: `out-${o.id}`,
      who: o.to_name || o.company || "Someone",
      company: o.to_name ? o.company : null,
      summary: o.subject ? `Replied to “${o.subject}”` : "Replied",
      url: gmailSearchUrl(o.to_email || o.to_name || o.company || ""),
      ready: false,
    });
  }
  return out;
}
