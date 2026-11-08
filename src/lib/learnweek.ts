// Learn screen (#/learn): one row per day in `learning_days` (engine migration "learning_days", 8 Nov 2026).
// Claude writes the plan (a domain lesson from the library plus an Operator voice session). Kuran ticks each block
// done and keeps a three-line confidence log; those columns are the only ones the console can change.
import { supabase, must } from "./supabase.ts";

export const LEARN_COLS = "day,theme,domain_ref,domain_part,domain_title,voice_ref,domain_done_at,voice_done_at,win,know,ask";

export interface LearnDay {
  day: string;
  theme: string | null;
  domain_ref: string | null;
  /** Which lesson of a course module to show. null = the whole module; -1 = only its self-check questions. */
  domain_part: number | null;
  domain_title: string | null;
  voice_ref: string | null;
  domain_done_at: string | null;
  voice_done_at: string | null;
  win: string | null;
  know: string | null;
  ask: string | null;
}

export type Block = "domain" | "voice";

function utc(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Monday of the UK week containing `day` ("YYYY-MM-DD"). */
export function mondayOf(day: string): string {
  const d = utc(day);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return iso(d);
}

/** The seven days Monday to Sunday starting at `monday`. */
export function weekDays(monday: string): string[] {
  const d = utc(monday);
  return Array.from({ length: 7 }, (_, i) => iso(new Date(d.getTime() + i * 86400e3)));
}

/** The day to open on: today if planned, else the next planned day, else the latest one. */
export function pickDay(rows: LearnDay[], today: string): string | null {
  if (!rows.length) return null;
  const days = rows.map((r) => r.day).sort();
  if (days.includes(today)) return today;
  return days.find((d) => d > today) ?? days[days.length - 1];
}

export const isDone = (r: LearnDay | undefined, b: Block) => !!(b === "domain" ? r?.domain_done_at : r?.voice_done_at);
export const dayComplete = (r: LearnDay | undefined) => isDone(r, "domain") && isDone(r, "voice");

/** Days in a row with both blocks done, ending today (or yesterday, if today is not finished yet). */
export function streak(rows: LearnDay[], today: string): number {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const cur = utc(today);
  if (!dayComplete(byDay.get(today))) cur.setUTCDate(cur.getUTCDate() - 1);
  let n = 0;
  while (dayComplete(byDay.get(iso(cur)))) {
    n++;
    cur.setUTCDate(cur.getUTCDate() - 1);
  }
  return n;
}

/** The plan and progress from four weeks back onwards. */
export async function learnDays(today: string): Promise<LearnDay[]> {
  const from = new Date(utc(today).getTime() - 28 * 86400e3);
  return must(
    await supabase.from("learning_days").select(LEARN_COLS).gte("day", iso(from)).order("day").limit(120),
  ) as unknown as LearnDay[];
}

export async function setDone(day: string, block: Block, done: boolean): Promise<LearnDay> {
  const col = block === "domain" ? "domain_done_at" : "voice_done_at";
  const now = new Date().toISOString();
  const rows = must(
    await supabase.from("learning_days").update({ [col]: done ? now : null, updated_at: now }).eq("day", day).select(LEARN_COLS),
  ) as unknown as LearnDay[];
  if (!rows[0]) throw new Error("That day isn’t in the plan any more. Reload the page.");
  return rows[0];
}

export async function saveLog(day: string, log: { win: string; know: string; ask: string }): Promise<LearnDay> {
  const clean = (s: string) => s.trim().slice(0, 600) || null;
  const rows = must(
    await supabase
      .from("learning_days")
      .update({ win: clean(log.win), know: clean(log.know), ask: clean(log.ask), updated_at: new Date().toISOString() })
      .eq("day", day)
      .select(LEARN_COLS),
  ) as unknown as LearnDay[];
  if (!rows[0]) throw new Error("That day isn’t in the plan any more. Reload the page.");
  return rows[0];
}

/** The instruction for a spoken practice chat with Claude (voice mode on the phone). */
export function practicePrompt(title: string, summary: string | null, theme: string | null): string {
  return [
    `Learning · Operator voice practice${theme ? ` (${theme})` : ""}.`,
    `Today's session: "${title}"${summary ? ` — ${summary}` : ""}`,
    "",
    "I'll use voice mode. Run a 10-minute spoken drill with me on today's skill:",
    "1. Play a senior counterparty who fits today (an investor, a powered-land owner or a GPU buyer). Stay in character, be realistic and a little blunt.",
    "2. Ask me 3–4 questions and push back twice. Keep your turns short.",
    "3. Then step out of character and give me a scorecard: answered first (yes/no per answer), questions I asked, longest answer, filler words you noticed, my strongest and weakest moment, and one line to use next time.",
    "",
    "Nodus rules apply: introductions only on capital, no fees, no returns, no invented track record. British English.",
    "At the end, add one line to nodus/50-learning/progress.md with today's date, the session and the score.",
  ].join("\n");
}
