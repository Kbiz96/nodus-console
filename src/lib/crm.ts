// CRM rules and helpers (contacts, deals, actions, outreach). Pure functions only, so they can be unit-tested.

export const CONTACT_LINES = [
  "Power-Buy", "Power-Sell", "Compute-Buy", "Compute-Sell", "Capital-Provide", "Capital-Raise", "Introducer", "Land-Sell", "Land-Buy",
] as const;

export const CONTACT_STAGES = [
  "New", "Drafted", "Contacted", "Replied", "Meeting", "Qualified", "Negotiating", "Won", "Nurture", "Declined", "Bounced", "Opted out", "Active", "Watch",
] as const;

export const DEAL_LINES = ["Power", "Critical power", "Compute", "Capital", "Powered land", "Partner", "Event", "Other"] as const;
export const DEAL_HEATS = ["Hot", "Warm", "Cold"] as const;
export const DEAL_STAGES = [
  "Lead", "Qualified", "Protected", "Verified", "Introduced", "Negotiating", "Closed – won", "Closed – lost", "Active", "Watch",
] as const;
export const CLOSED_STAGES = ["Closed – won", "Closed – lost"];
export const GATE_VALUES = ["Yes", "No", "N/A"] as const;

export const OUTREACH_STATUSES = ["draft", "approved", "manual", "sent", "replied", "skipped", "expired"] as const;
export const OUTREACH_STATUS_LABEL: Record<string, string> = {
  draft: "To approve",
  approved: "Approved (email queue)",
  manual: "LinkedIn to send",
  sent: "Sent",
  replied: "Replied",
  skipped: "Skipped",
  expired: "Expired",
  failed: "Failed",
  parked: "Parked",
};
export const OUTREACH_KIND_LABEL: Record<string, string> = {
  email: "Email",
  followup: "Follow-up",
  dm: "LinkedIn DM",
  connect: "Connection request",
  comment: "LinkedIn comment",
  post: "LinkedIn post",
};

export const MANDATE_KINDS = ["investor_mandate", "site", "capital_ask", "need"] as const;
export const MANDATE_KIND_LABEL: Record<string, string> = {
  investor_mandate: "Investor mandate",
  site: "Site",
  capital_ask: "Capital ask",
  need: "Need",
};
export const CONFIDENCES = ["stated", "partial", "to_ask"] as const;
export const CONFIDENCE_LABEL: Record<string, string> = { stated: "Stated", partial: "Partial", to_ask: "To ask" };
export const CARD_FIELDS: { key: string; label: string }[] = [
  { key: "ticket", label: "Ticket" },
  { key: "geography", label: "Geography" },
  { key: "stage", label: "Stage" },
  { key: "mw", label: "MW" },
  { key: "structure", label: "Structure" },
  { key: "risk", label: "Risk" },
  { key: "investor_type", label: "Investor type" },
];

// ---------- deal gates ----------

export interface DealGates {
  principal_verified?: string | null;
  ncnda_signed?: string | null;
  fee_signed?: string | null;
  kyc_done?: string | null;
  proof_done?: string | null;
}
export const GATE_FIELDS: { key: keyof DealGates; label: string }[] = [
  { key: "principal_verified", label: "Principal verified" },
  { key: "ncnda_signed", label: "NCNDA signed" },
  { key: "fee_signed", label: "Fee agreement signed" },
  { key: "kyc_done", label: "KYC done" },
  { key: "proof_done", label: "Proof done" },
];

export function isYes(v: unknown): boolean {
  return typeof v === "string" && v.trim().toLowerCase() === "yes";
}

/** How many of the five gates are "Yes" (0–5). */
export function gateScore(d: DealGates): number {
  return GATE_FIELDS.reduce((n, f) => n + (isYes(d[f.key]) ? 1 : 0), 0);
}

/**
 * Why a deal may not be at this stage yet, or null if it may.
 * Protected needs the NCNDA and fee agreement signed. Verified (and Introduced, which comes after it) also need
 * the principal verified, KYC and proof done.
 */
export function stageBlocker(stage: string, d: DealGates): string | null {
  const missing = (keys: (keyof DealGates)[]) =>
    keys.filter((k) => !isYes(d[k])).map((k) => GATE_FIELDS.find((f) => f.key === k)!.label);
  const protectedKeys: (keyof DealGates)[] = ["ncnda_signed", "fee_signed"];
  const verifiedKeys: (keyof DealGates)[] = [...protectedKeys, "principal_verified", "kyc_done", "proof_done"];
  const need = stage === "Protected" ? protectedKeys : stage === "Verified" || stage === "Introduced" ? verifiedKeys : null;
  if (!need) return null;
  const m = missing(need);
  if (m.length === 0) return null;
  return `${stage} needs ${listAnd(m)} to be Yes first.`;
}

function listAnd(xs: string[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

export function isClosed(stage: string | null | undefined): boolean {
  return CLOSED_STAGES.includes(stage ?? "");
}

const HEAT_ORDER: Record<string, number> = { Hot: 0, Warm: 1, Cold: 2 };

/** Hot → Warm → Cold, then rank (lowest first, blanks last). */
export function compareDeals(a: { heat: string | null; rank: number | null }, b: { heat: string | null; rank: number | null }): number {
  const h = (HEAT_ORDER[a.heat ?? ""] ?? 3) - (HEAT_ORDER[b.heat ?? ""] ?? 3);
  if (h) return h;
  const ra = a.rank ?? Number.POSITIVE_INFINITY;
  const rb = b.rank ?? Number.POSITIVE_INFINITY;
  return ra === rb ? 0 : ra < rb ? -1 : 1;
}

// ---------- actions ----------

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2 };

/** Focus rank (blanks last), then priority (urgent, high, normal), then due date (blanks last). */
export function compareActions(
  a: { focus_rank: number | null; priority: string | null; due: string | null },
  b: { focus_rank: number | null; priority: string | null; due: string | null },
): number {
  const fa = a.focus_rank ?? Number.POSITIVE_INFINITY;
  const fb = b.focus_rank ?? Number.POSITIVE_INFINITY;
  if (fa !== fb) return fa < fb ? -1 : 1;
  const p = (PRIORITY_ORDER[(a.priority ?? "").toLowerCase()] ?? 3) - (PRIORITY_ORDER[(b.priority ?? "").toLowerCase()] ?? 3);
  if (p) return p;
  if (a.due === b.due) return 0;
  if (!a.due) return 1;
  if (!b.due) return -1;
  return a.due < b.due ? -1 : 1;
}

// ---------- dates and notes ----------

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });

/** Today's date in the UK, as "YYYY-MM-DD". */
export function ukToday(now = new Date()): string {
  return dayFmt.format(now);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A plain "YYYY-MM-DD" date shown UK style ("22 Oct 2026"), without any time-zone shift. */
export function fmtDay(day: string | null | undefined, empty = "—"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day ?? "");
  if (!m) return empty;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** True when a "YYYY-MM-DD" date is before today (UK). */
export function isOverdue(day: string | null | undefined, today = ukToday()): boolean {
  return Boolean(day) && String(day).slice(0, 10) < today;
}

/** True when a "YYYY-MM-DD" date is today or earlier (UK). */
export function isDue(day: string | null | undefined, today = ukToday()): boolean {
  return Boolean(day) && String(day).slice(0, 10) <= today;
}

/**
 * Add a dated line to the end of existing notes, never replacing them: "YYYY-MM-DD: text".
 * Returns null when there is nothing to add.
 */
export function appendNote(existing: string | null | undefined, text: string, day = ukToday()): string | null {
  const clean = text.replace(/\s*\n\s*/g, " ").trim();
  if (!clean) return null;
  const line = `${day}: ${clean}`;
  const before = (existing ?? "").replace(/\s+$/, "");
  return before ? `${before}\n${line}` : line;
}

// ---------- old HQ import ----------

export const IMPORT_KEYS = ["contacts", "deals", "actions", "outreach", "mandates"] as const;

/** Checks a parsed HQ export. Returns counts per key, or the reason it cannot be imported. */
export function checkHqExport(v: unknown): { ok: true; date: string | null; counts: Record<string, number> } | { ok: false; error: string } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "That file is not a Nodus HQ export." };
  const o = v as Record<string, unknown>;
  if (o.export !== "nodus-hq") return { ok: false, error: "That file is not a Nodus HQ export (it should say export: nodus-hq)." };
  const counts: Record<string, number> = {};
  for (const k of IMPORT_KEYS) counts[k] = Array.isArray(o[k]) ? (o[k] as unknown[]).length : 0;
  return { ok: true, date: typeof o.date === "string" ? o.date : null, counts };
}
