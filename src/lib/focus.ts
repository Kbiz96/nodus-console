// Focus screen rules: the next send slot, the order of the review deck and the Claude prompts.
// Pure functions only, so they can be unit-tested.

import type { Outreach, Priority } from "./types.ts";

// ---------- send slots ----------

/** The send batch runs at these UK times, Monday to Friday. */
export const SEND_SLOTS = ["09:53", "12:53", "15:53"] as const;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ukParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partsOf(d: Date): { y: number; m: number; d: number; mins: number } {
  const p: Record<string, string> = {};
  for (const { type, value } of ukParts.formatToParts(d)) p[type] = value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), mins: Number(p.hour) * 60 + Number(p.minute) };
}

export interface SendSlot {
  /** UK date of the slot, "YYYY-MM-DD". */
  day: string;
  /** UK clock time, "12:53". */
  time: string;
  /** "today", "tomorrow" or a weekday name. */
  when: string;
  /** "12:53 today", "09:53 on Monday". */
  label: string;
}

/**
 * The next time the send batch will pick up an approved email: the first weekday slot strictly after `now`
 * (UK time). A slot that is starting this very minute is treated as gone, because the batch may already have run.
 */
export function nextSendSlot(now = new Date()): SendSlot {
  const t = partsOf(now);
  for (let add = 0; add < 8; add++) {
    const day = new Date(Date.UTC(t.y, t.m - 1, t.d + add));
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (const s of SEND_SLOTS) {
      const [h, m] = s.split(":").map(Number);
      if (add === 0 && h * 60 + m <= t.mins) continue;
      const when = add === 0 ? "today" : add === 1 ? "tomorrow" : WEEKDAYS[dow];
      const iso = day.toISOString().slice(0, 10);
      return { day: iso, time: s, when, label: add <= 1 ? `${s} ${when}` : `${s} on ${when}` };
    }
  }
  throw new Error("no send slot within a week"); // cannot happen: every week has weekdays
}

// ---------- the review deck ----------

/** Drafts waiting for a decision and LinkedIn messages approved but not yet sent. */
export const DECK_STATUSES = ["draft", "manual"] as const;

export function isLinkedIn(o: Pick<Outreach, "channel" | "kind">): boolean {
  return o.channel === "linkedin" || (!o.channel && ["dm", "connect", "comment", "post"].includes(o.kind ?? ""));
}

/**
 * Deck order: items tagged with an active priority first, by that priority's rank; then everything else.
 * Within a group, oldest first, so nothing waits forever. Items whose priority is paused or done count as untagged.
 */
export function deckOrder<T extends Pick<Outreach, "id" | "created_at"> & { priority_id?: string | null }>(
  items: T[],
  priorities: Pick<Priority, "id" | "rank" | "status">[],
): T[] {
  const rank = new Map(priorities.filter((p) => p.status === "active").map((p) => [p.id, p.rank]));
  const key = (o: T) => (o.priority_id && rank.has(o.priority_id) ? rank.get(o.priority_id)! : Number.POSITIVE_INFINITY);
  return [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== kb) return ka < kb ? -1 : 1;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Active priorities in rank order (ties by title). */
export function activeInOrder<T extends Pick<Priority, "rank" | "status" | "title">>(ps: T[]): T[] {
  return ps.filter((p) => p.status === "active").sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
}

// ---------- Claude prompts ----------

export const ASKS = [
  { key: "find", label: "Find 25 more people" },
  { key: "followups", label: "Draft follow-ups" },
  { key: "blocking", label: "What's blocking this?" },
  { key: "summary", label: "Summarise where we are" },
] as const;
export type AskKey = (typeof ASKS)[number]["key"];

type PromptPriority = Pick<Priority, "rank" | "title" | "goal" | "who" | "next_action">;

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
}

/** The ready instruction for a Claude chat about one priority. With no ask, it runs the priority's next action. */
export function priorityPrompt(p: PromptPriority, ask?: AskKey): string {
  const head = `Nodus command (priority ${p.rank}: ${clean(p.title)})`;
  const who = clean(p.who) ? ` Who we need: ${clean(p.who)}.` : "";
  const goal = clean(p.goal) ? ` Goal: ${clean(p.goal)}.` : "";
  const tag = `tag drafts with priority ${p.rank}`;
  switch (ask) {
    case "find":
      return `${head}: find 25 more people we should reach.${who} Follow the nodus-command playbook: check the CRM first and skip anyone already contacted, find people, draft for my approval, ${tag}.`;
    case "followups":
      return `${head}: draft follow-ups for everyone we have contacted on this priority who has not replied.${who} Follow the nodus-command playbook: check the CRM and Gmail, draft for my approval, ${tag}.`;
    case "blocking":
      return `${head}: what's blocking this?${goal} Check the CRM, deals and mandate cards for this priority, then tell me the one thing that would move it most. Do not send anything.`;
    case "summary":
      return `${head}: summarise where we are.${goal} Check the CRM, outreach and deals for this priority. Short and decision-first: what has moved, what is stuck, what I should do next.`;
    default: {
      const next = clean(p.next_action) || "decide the next step";
      return `${head}: ${next}.${who} Follow the nodus-command playbook: check the CRM, find people, draft for my approval, ${tag}.`;
    }
  }
}

/** A reply to someone who has written back. */
export function replyPrompt(o: Pick<Outreach, "to_name" | "company" | "subject" | "replied_at">, priorityRank?: number | null, repliedDay?: string): string {
  const who = [clean(o.to_name) || "this contact", clean(o.company) ? `at ${clean(o.company)}` : ""].filter(Boolean).join(" ");
  const thread = clean(o.subject) ? ` The thread is "${clean(o.subject)}".` : "";
  const when = repliedDay ? ` They replied on ${repliedDay}.` : "";
  const tag = priorityRank ? `, tag it with priority ${priorityRank}` : "";
  return `Nodus command: draft a reply to ${who}.${thread}${when} Follow the nodus-command playbook: read the thread in Gmail and check the CRM, draft the reply for my approval${tag}. Do not send anything.`;
}

// ---------- header ----------

const ukHour = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hourCycle: "h23" });
const ukLongDay = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" });

export function greeting(now = new Date()): string {
  const h = Number(ukHour.format(now));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** "Friday 23 October" in UK time. */
export function ukLongDate(now = new Date()): string {
  return ukLongDay.format(now).replace(",", "");
}
