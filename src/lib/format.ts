// All times are shown in UK time (Europe/London). Dates look like "15 Oct 2026".

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function toDate(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? null : x;
}

function ukParts(d: Date) {
  const p: Record<string, string> = {};
  for (const { type, value } of partsFmt.formatToParts(d)) p[type] = value;
  return p;
}

export function fmtDate(d: Date | string | null | undefined, empty = "—"): string {
  const x = toDate(d);
  if (!x) return empty;
  const p = ukParts(x);
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]} ${p.year}`;
}

export function fmtDateTime(d: Date | string | null | undefined, empty = "—"): string {
  const x = toDate(d);
  if (!x) return empty;
  const p = ukParts(x);
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute}`;
}

/** First day of the current month in UK time, as "YYYY-MM-01". */
export function ukMonthStart(now = new Date()): string {
  const p = ukParts(now);
  return `${p.year}-${p.month.padStart(2, "0")}-01`;
}

/** Minutes that UK time is ahead of UTC at a given instant (0 in winter, 60 in summer). */
function ukOffsetMinutes(at: Date): number {
  const p = ukParts(at);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/** The UTC instant (ISO string) of midnight UK time at the start of the given "YYYY-MM-DD" day. */
export function ukDayStartIso(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  const offset = ukOffsetMinutes(new Date(guess.getTime() - 60 * 60000)); // offset just before midnight
  return new Date(guess.getTime() - offset * 60000).toISOString();
}

/** The day after "YYYY-MM-DD", as "YYYY-MM-DD". */
export function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function fmtGBP(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number.isFinite(v) ? v : 0);
}

export function fmtNumber(n: number | string | null | undefined, digits = 0): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits }).format(v);
}

export function fmtMW(n: unknown): string {
  const v = typeof n === "number" ? n : typeof n === "string" && n.trim() !== "" ? Number(n) : NaN;
  return Number.isFinite(v) ? `${fmtNumber(v, v < 10 ? 1 : 0)} MW` : "—";
}

/** A number from a JSON value (numbers, or numeric strings), otherwise null. */
export function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Only allow http(s) links to be rendered as anchors. */
export function safeHref(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** "NOD-1A2B3C4D" style reference from a uuid. */
export function reference(id: string, prefix = "NOD"): string {
  return `${prefix}-${id.slice(0, 8).toUpperCase()}`;
}

/** File name for a CRM export, e.g. nodus-match-1a2b3c4d-2026-10-15.json (UK date). */
export function exportFilename(matchId: string, now = new Date()): string {
  const p = ukParts(now);
  return `nodus-match-${matchId.slice(0, 8)}-${p.year}-${p.month.padStart(2, "0")}-${p.day.padStart(2, "0")}.json`;
}
