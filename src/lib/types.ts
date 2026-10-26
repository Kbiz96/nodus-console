import type { FeedbackExplanation } from "./feedback.ts";

export interface Evidence {
  title?: string;
  url?: string;
  quote?: string;
}
export interface Explanation {
  why?: string[];
  unknowns?: string[];
  next_step?: string;
  evidence?: Evidence[];
  feedback?: FeedbackExplanation;
}

/** A row of the v_match_cards view. */
export interface MatchCardRow {
  id: string;
  status: string;
  total_score: number;
  scores: Record<string, number>;
  thesis: string | null;
  explanation: Explanation | null;
  reject_reason: string | null;
  created_at: string;
  line: string | null;
  supply_id: string | null;
  supply_title: string | null;
  supply_gate: string | null;
  need_id: string | null;
  need_title: string | null;
  need_gate: string | null;
  mandate_id: string | null;
  mandate_label: string | null;
}

/** The shape returned by the search_all database function. */
export interface SearchAll {
  organisations: { id: string; title: string; country: string | null; status: string; at: string | null }[];
  opportunities: {
    id: string; title: string; line: string; side: string; region: string | null; country: string | null;
    mw: unknown; gate: string; credibility: number; at: string | null;
  }[];
  signals: { id: string; title: string; line: string | null; signal_type: string; source_url: string; confidence: number; at: string | null }[];
  matches: { id: string; title: string | null; total_score: number; status: string; at: string | null }[];
  mandates: { id: string; title: string; line: string; active: boolean; at: string | null }[];
}

// ---------- CRM (merged from the old Nodus HQ) ----------

export interface CrmContact {
  id: string;
  name: string | null;
  title: string | null;
  company: string | null;
  email: string | null;
  linkedin: string | null;
  country: string | null;
  lines: string[] | null;
  side: string | null;
  category: string | null;
  stage: string | null;
  priority: string | null;
  channel: string | null;
  source: string | null;
  signal: string | null;
  first_contact: string | null;
  last_activity: string | null;
  next_follow_up: string | null;
  do_not_contact: boolean | null;
  notes: string | null;
  updated_at: string | null;
}

export interface Deal {
  id: string;
  deal: string | null;
  contact_id: string | null;
  counterparty: string | null;
  line: string | null;
  heat: string | null;
  rank: number | null;
  stage: string | null;
  principal_verified: string | null;
  ncnda_signed: string | null;
  fee_signed: string | null;
  kyc_done: string | null;
  proof_done: string | null;
  next_date: string | null;
  next_step: string | null;
  value: string | null;
  terms: string | null;
  notes: string | null;
  updated_at: string | null;
}

export interface CrmAction {
  id: string;
  title: string | null;
  detail: string | null;
  priority: string | null;
  due: string | null;
  category: string | null;
  status: string;
  contact_id: string | null;
  deal_id: string | null;
  link: string | null;
  focus_rank: number | null;
}

export interface Outreach {
  id: string;
  kind: string | null;
  channel: string | null;
  contact_id: string | null;
  to_name: string | null;
  to_email: string | null;
  company: string | null;
  subject: string | null;
  body: string | null;
  link: string | null;
  sequence_step: number | null;
  status: string;
  note: string | null;
  origin: string | null;
  created_at: string;
  approved_at: string | null;
  sent_at: string | null;
  replied_at: string | null;
  /** Which priority this message serves (migration 0019). */
  priority_id?: string | null;
}

// ---------- priorities (migration 0019) ----------

export type PriorityStatus = "active" | "paused" | "done";

/** One of Kuran's few live priorities: what Nodus is trying to close this week. */
export interface Priority {
  id: string;
  rank: number;
  title: string;
  goal: string | null;
  who: string | null;
  next_action: string | null;
  line: string | null;
  mandate_ids: string[] | null;
  deal_ids: string[] | null;
  status: PriorityStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** CRM contact lines this priority needs, e.g. ["Capital-Provide"] (used by priority_network). */
  target_lines?: string[] | null;
  keywords?: string[] | null;
  region_pattern?: string | null;
}

/** A row from the priority_network database function: someone already in the CRM who fits a priority. */
export interface NetworkRow {
  contact_id: string;
  name: string | null;
  title: string | null;
  company: string | null;
  country: string | null;
  stage: string | null;
  linkedin: string | null;
  email: string | null;
  score: number;
  reasons: string[] | null;
  last_touch: string | null;
}

/** A row of the priority_progress view: outreach counts per priority. */
export interface PriorityProgress {
  priority_id: string;
  drafts: number;
  approved: number;
  sent: number;
  replied: number;
  manual: number;
  last_sent_at: string | null;
}
