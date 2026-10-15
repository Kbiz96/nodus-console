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
