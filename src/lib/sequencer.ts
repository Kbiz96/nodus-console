// The opportunity sequencer: every engine opportunity has a stage, and one click moves it on.
// Pure functions only (stage labels, the next step, Claude prompts, database payloads), so they can be unit-tested.

import { claudeLink, type ClaudeLink } from "./claude.ts";
import { reference } from "./format.ts";

export const STAGES = ["found", "researched", "people", "drafted", "contacted", "conversation", "protected"] as const;
export type LiveStage = (typeof STAGES)[number];
export type Stage = LiveStage | "dismissed";
export const ALL_STAGES: readonly Stage[] = [...STAGES, "dismissed"];

export const STAGE_LABEL: Record<Stage, string> = {
  found: "Found",
  researched: "Researched",
  people: "People",
  drafted: "Drafted",
  contacted: "Contacted",
  conversation: "In conversation",
  protected: "Protected",
  dismissed: "Dismissed",
};

export const STAGE_HINT: Record<Stage, string> = {
  found: "The engine found it. Nobody has looked yet.",
  researched: "Diligence done: what they need, the value exchange and the angle.",
  people: "Decision makers found.",
  drafted: "Outreach drafted and waiting for your approval.",
  contacted: "First touch sent.",
  conversation: "They replied, or a meeting is in motion.",
  protected: "NCNDA and fee protection signed.",
  dismissed: "Taken off the board.",
};

/** Ring colours on the map and the engine board, from quiet to bright as an opportunity moves on. */
export const STAGE_COLOUR: Record<Stage, string> = {
  found: "transparent",
  researched: "#6f9fb8",
  people: "#7fb6c9",
  drafted: "#9fd0c2",
  contacted: "#c9e7a6",
  conversation: "#f0d08a",
  protected: "#ffffff",
  dismissed: "#56625f",
};

export function parseStage(s: unknown): Stage {
  return typeof s === "string" && (ALL_STAGES as readonly string[]).includes(s) ? (s as Stage) : "found";
}

/** 0..6 along the track; -1 when dismissed. */
export function stageIndex(s: Stage): number {
  return s === "dismissed" ? -1 : STAGES.indexOf(s);
}

/** What Claude is asked to do. "work" runs every step from the current stage up to drafted. */
export type SeqAction = "work" | "research" | "people" | "draft" | "follow-up";

export type NextStep =
  | { kind: "claude"; action: Exclude<SeqAction, "work">; label: string }
  | { kind: "review"; label: string }
  | { kind: "deal"; label: string }
  | { kind: "restore"; label: string };

/** The one next step for an opportunity at this stage, with its button label. */
export function nextStep(stage: Stage): NextStep {
  switch (stage) {
    case "found": return { kind: "claude", action: "research", label: "Research it" };
    case "researched": return { kind: "claude", action: "people", label: "Find the people" };
    case "people": return { kind: "claude", action: "draft", label: "Draft outreach" };
    case "drafted": return { kind: "review", label: "Review & send" };
    case "contacted": return { kind: "claude", action: "follow-up", label: "Draft follow-up" };
    case "conversation":
    case "protected": return { kind: "deal", label: "Open the deal" };
    case "dismissed": return { kind: "restore", label: "Bring back" };
  }
}

/** "Work it" only makes sense before the drafts exist. */
export function canWork(stage: Stage): boolean {
  const i = stageIndex(stage);
  return i >= 0 && i < STAGES.indexOf("drafted");
}

export const DISMISS_REASONS = ["Noise", "Not our line", "Too early", "Already known", "Broker chain"] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

export interface PipelineRow {
  opportunity_id: string;
  stage: Stage;
  dismissed_reason: string | null;
  updated_at: string;
  next_action?: string | null;
}

/** Rows to upsert into opportunity_pipeline (on opportunity_id) to dismiss these opportunities. */
export function dismissPayload(ids: string[], reason: string, now = new Date()): PipelineRow[] {
  const at = now.toISOString();
  return [...new Set(ids)].map((opportunity_id) => ({ opportunity_id, stage: "dismissed", dismissed_reason: reason, next_action: null, updated_at: at }));
}

/**
 * Rows that undo a dismissal. The live stage is worked out from outreach, leads, contacts and deals, so the
 * pipeline only needs to hold "found" (or "researched") and the evidence lifts it to wherever it really is.
 */
export function restorePayload(prev: Map<string, Stage> | Record<string, Stage>, now = new Date()): PipelineRow[] {
  const at = now.toISOString();
  const entries = prev instanceof Map ? [...prev.entries()] : Object.entries(prev);
  return entries.map(([opportunity_id, s]) => ({
    opportunity_id,
    stage: s === "researched" ? "researched" : "found",
    dismissed_reason: null,
    updated_at: at,
  }));
}

// ---------- the Claude command ----------

export interface SeqOpp {
  id: string;
  title: string | null;
  org?: string | null;
  evidence?: string | null;
  stage?: Stage;
}

/** A single chat handles at most this many opportunities; more are split into batches. */
export const BATCH_CAP = 15;

export function batches<T>(items: T[], cap = BATCH_CAP): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += cap) out.push(items.slice(i, i + cap));
  return out;
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").trim();

/** `NOD-1A2B3C4D | title | opportunity_id <uuid> | org <name> | evidence <url>` */
export function oppLine(o: SeqOpp): string {
  return [
    reference(o.id),
    clean(o.title) || "Untitled",
    `opportunity_id ${o.id}`,
    `org ${clean(o.org) || "unknown"}`,
    `evidence ${clean(o.evidence) || "none linked"}`,
  ].join(" | ");
}

export const ACTION_LABEL: Record<SeqAction, string> = {
  work: "Work it (all the way to drafted)",
  research: "Research it",
  people: "Find the people",
  draft: "Draft outreach",
  "follow-up": "Draft follow-up",
};

const STEP_NAME: Record<Exclude<SeqAction, "work">, string> = {
  research: "research",
  people: "people",
  draft: "draft",
  "follow-up": "follow-up",
};

export const WORK_TAIL =
  'Follow the nodus-command playbook section "Opportunity sequencer": run every stage from the current one up to drafted ' +
  "(research → people → relationship-opener outreach: email + LinkedIn connection note + DM with profile link), " +
  "save research to opportunity_pipeline, drafts to outreach linked by opportunity_id, show me the drafts here and send the emails when I say send.";

const STEP_DETAIL: Record<Exclude<SeqAction, "work">, string> = {
  research: "diligence from the signals and evidence plus a short web check; save research {summary, what_they_need, value_exchange, angle, risks, sources} to opportunity_pipeline, or dismiss it with a reason if it is noise, then stop and tell me what you found",
  people: "1–3 decision makers, CRM first, then Apollo; add them to lead_candidates with opportunity_id, skip anyone already contacted, then stop and list them here",
  draft: "relationship-opener outreach for the people already found: email + LinkedIn connection note + DM with profile link, no details disclosed; save drafts to outreach linked by opportunity_id, show me the drafts here and send the emails when I say send",
  "follow-up": "a short follow-up on the first touch already sent, in the same thread and voice; save it to outreach linked by opportunity_id, show it to me here and send it when I say send",
};

/** The "Nodus command" for one chat. `batch` says which of several chats this is. */
export function sequencerPrompt(action: SeqAction, opps: SeqOpp[], batch?: { n: number; of: number }): string {
  const n = opps.length;
  const what = n === 1 ? "this opportunity" : `these ${n} opportunities`;
  const part = batch && batch.of > 1 ? ` (batch ${batch.n} of ${batch.of}; the other batches have their own chats)` : "";
  const head =
    action === "work"
      ? `Nodus command (opportunity sequencer: Work it): take ${what} to drafted${part}.`
      : `Nodus command (opportunity sequencer: ${ACTION_LABEL[action]}): run only the ${STEP_NAME[action]} step for ${what}${part}.`;
  const tail =
    action === "work"
      ? WORK_TAIL
      : `Follow the nodus-command playbook section "Opportunity sequencer": run only the ${STEP_NAME[action]} step (${STEP_DETAIL[action]}).`;
  return [head, "", ...opps.map(oppLine), "", tail].join("\n");
}

export interface SeqChat extends ClaudeLink {
  text: string;
  ids: string[];
}

/** One chat per batch of 15, each a link into the Nodus project. */
export function sequencerChats(action: SeqAction, opps: SeqOpp[], cap = BATCH_CAP): SeqChat[] {
  const uniq = [...new Map(opps.filter((o) => o.id).map((o) => [o.id, o])).values()];
  const bs = batches(uniq, cap);
  return bs.map((b, i) => {
    const text = sequencerPrompt(action, b, { n: i + 1, of: bs.length });
    return { ...claudeLink(text), text, ids: b.map((o) => o.id) };
  });
}

// ---------- research ----------

export interface Research {
  summary: string | null;
  what_they_need: string | null;
  value_exchange: string | null;
  angle: string | null;
  risks: string | null;
  sources: string[];
}

const txt = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean).join("; ") || null;
  const s = String(v).trim();
  return s ? s : null;
};

/** Research as saved by Claude, or null when there is nothing to show. */
export function parseResearch(r: unknown): Research | null {
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const o = r as Record<string, unknown>;
  const sources = (Array.isArray(o.sources) ? o.sources : [])
    .map((s) => (typeof s === "string" ? s : s && typeof s === "object" ? String((s as Record<string, unknown>).url ?? "") : ""))
    .filter((s) => /^https?:\/\//.test(s));
  const out: Research = {
    summary: txt(o.summary),
    what_they_need: txt(o.what_they_need),
    value_exchange: txt(o.value_exchange),
    angle: txt(o.angle),
    risks: txt(o.risks),
    sources,
  };
  return out.summary || out.what_they_need || out.value_exchange || out.angle || out.risks || sources.length ? out : null;
}
