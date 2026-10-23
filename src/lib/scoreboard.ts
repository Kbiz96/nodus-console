// Weekly scoreboard: this week (Monday to Sunday, UK time) against last week. Pure functions only.
import { ukDayStartIso } from "./format.ts";

export const SCORE_METRICS = [
  { key: "mandates_new", label: "New mandate cards" },
  { key: "matches_accepted", label: "Matches shortlisted" },
  { key: "drafts_approved", label: "Drafts approved" },
  { key: "emails_sent", label: "Emails sent" },
  { key: "replies", label: "Replies" },
  { key: "meetings", label: "Meetings" },
  { key: "ncndas_signed", label: "NCNDAs signed" },
  { key: "fees_signed", label: "Fee letters signed" },
] as const;
export type ScoreKey = (typeof SCORE_METRICS)[number]["key"];
export type ScoreCounts = Partial<Record<ScoreKey, number>> & { tracking_since?: string | null };

const ukDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The Monday (UK) of the week containing `now`, as "YYYY-MM-DD". */
export function ukWeekStart(now = new Date()): string {
  const today = ukDay.format(now);
  const [y, m, d] = today.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(today, -((dow + 6) % 7));
}

export interface Period {
  label: string;
  from: string; // UTC instant of Monday 00:00 UK
  to: string; // UTC instant of the next Monday 00:00 UK (exclusive)
  firstDay: string;
  lastDay: string;
}

/** This week and last week, as UTC instants for UK days (clock changes handled). */
export function weekPeriods(now = new Date()): { thisWeek: Period; lastWeek: Period } {
  const mon = ukWeekStart(now);
  const prev = addDays(mon, -7);
  const next = addDays(mon, 7);
  return {
    thisWeek: { label: "This week", from: ukDayStartIso(mon), to: ukDayStartIso(next), firstDay: mon, lastDay: addDays(mon, 6) },
    lastWeek: { label: "Last week", from: ukDayStartIso(prev), to: ukDayStartIso(mon), firstDay: prev, lastDay: addDays(prev, 6) },
  };
}

/** A count from the database, or 0 when missing or not a number. */
export function countOf(c: ScoreCounts | null | undefined, key: ScoreKey): number {
  const v = Number(c?.[key]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** Change against last week: "+3", "−2" or "=" (no change), and which way it went. */
export function delta(thisWeek: number, lastWeek: number): { text: string; dir: "up" | "down" | "same" } {
  const d = thisWeek - lastWeek;
  if (d > 0) return { text: `+${d}`, dir: "up" };
  if (d < 0) return { text: `−${-d}`, dir: "down" };
  return { text: "=", dir: "same" };
}

/** One row per metric, in display order. */
export function scoreRows(thisWeek: ScoreCounts | null, lastWeek: ScoreCounts | null) {
  return SCORE_METRICS.map((m) => {
    const a = countOf(thisWeek, m.key);
    const b = countOf(lastWeek, m.key);
    return { ...m, thisWeek: a, lastWeek: b, change: delta(a, b) };
  });
}

/** True when meetings / NCNDAs / fee letters started being tracked after this period began (so last week may be short). */
export function trackedLate(trackingSince: string | null | undefined, periodFrom: string): boolean {
  if (!trackingSince) return false;
  const t = Date.parse(trackingSince);
  const f = Date.parse(periodFrom);
  return Number.isFinite(t) && Number.isFinite(f) && t > f;
}
