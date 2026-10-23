// Reject reasons (database function match_reject, engine migration 0018). The engine learns from these:
// it stops proposing the same organisation for the same mandate, and down-weights matches like ones you
// have rejected more than once for the same reason. Pure functions only, so they can be unit-tested.

export const REJECT_REASONS = [
  { code: "wrong_line", label: "Wrong line" },
  { code: "wrong_geography", label: "Wrong geography" },
  { code: "too_small", label: "Too small" },
  { code: "too_big", label: "Too big" },
  { code: "wrong_stage", label: "Wrong stage" },
  { code: "noise", label: "Not a real opportunity / noise" },
  { code: "already_known", label: "Already known" },
  { code: "counterparty_unsuitable", label: "Counterparty unsuitable" },
  { code: "other", label: "Other" },
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number]["code"];

export const NOTE_MAX = 2000;

/** Why this reject cannot be saved yet, or null when it can. Mirrors the database's own checks. */
export function rejectProblem(reason: string, note: string): string | null {
  if (!REJECT_REASONS.some((r) => r.code === reason)) return "Pick a reason.";
  const n = note.trim();
  if (reason === "other" && n.length < 3) return "Say briefly why (a few words) when the reason is Other.";
  if (n.length > NOTE_MAX) return "Keep the note under 2,000 characters.";
  return null;
}

export interface FeedbackExplanation {
  raw_total?: number;
  adjustment?: number;
  notes?: string[];
}

/** One line for a match card, e.g. "Down-weighted 8 points: 2 similar rejected as wrong geography (country DE)". */
export function feedbackLine(fb: FeedbackExplanation | null | undefined): string | null {
  if (!fb || typeof fb !== "object") return null;
  const pts = Math.abs(Number(fb.adjustment));
  const notes = Array.isArray(fb.notes) ? fb.notes.filter((x) => typeof x === "string" && x) : [];
  if (!Number.isFinite(pts) || pts <= 0 || notes.length === 0) return null;
  return `Down-weighted ${Math.round(pts * 10) / 10} points: ${notes.join("; ")}`;
}
