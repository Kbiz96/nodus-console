// Plain-English labels for the engine's codes.

export const LINES = ["critical_power", "compute", "capital", "powered_land"] as const;
export type Line = (typeof LINES)[number];

export const LINE_LABEL: Record<string, string> = {
  critical_power: "Critical power",
  compute: "Compute",
  capital: "Capital introductions",
  powered_land: "Powered land",
};

export const SIDES = ["supply", "need"] as const;
export const SIDE_LABEL: Record<string, string> = { supply: "Supply", need: "Need" };
export const SIDE_HINT: Record<string, string> = {
  supply: "has something to offer",
  need: "is looking for something",
};

export const GATES = ["unverified", "qualified", "protected", "verified", "introduced"] as const;
export type Gate = (typeof GATES)[number];
export const GATE_LABEL: Record<string, string> = {
  unverified: "Unverified",
  qualified: "Qualified",
  protected: "Protected",
  verified: "Verified",
  introduced: "Introduced",
};
export const GATE_HINT: Record<string, string> = {
  unverified: "Found by the engine; not yet checked.",
  qualified: "You have checked it looks real and relevant.",
  protected: "NCNDA and fee protection are signed.",
  verified: "Facts confirmed with the counterparty.",
  introduced: "The two sides have been introduced.",
};

export const MATCH_STATUSES = ["proposed", "shortlisted", "rejected", "sent_to_crm"] as const;
export const MATCH_STATUS_LABEL: Record<string, string> = {
  proposed: "New",
  shortlisted: "Shortlisted",
  rejected: "Rejected",
  sent_to_crm: "Sent to CRM",
};

export const SANCTIONS_LABEL: Record<string, string> = {
  unscreened: "Not yet checked",
  clear: "Clear",
  possible_match: "Possible match — needs your review",
  blocked: "Blocked",
};

export const SCORE_PARTS: { key: string; label: string; hint: string }[] = [
  { key: "fit", label: "Fit", hint: "How well the two sides fit each other" },
  { key: "timing", label: "Timing", hint: "Whether the dates line up" },
  { key: "credibility", label: "Credibility", hint: "How trustworthy the sources are" },
  { key: "reachability", label: "Reachability", hint: "How easily Nodus can reach the parties" },
  { key: "nodus_edge", label: "Nodus edge", hint: "Where Nodus has an advantage" },
  { key: "value", label: "Value", hint: "Likely size of the deal" },
];

export const ACCESS_LABEL: Record<string, string> = {
  api: "API",
  bulk: "Bulk download",
  rss: "News feed",
  manual: "Manual",
  licensed: "Licensed",
};

export const TIER_LABEL: Record<string, string> = {
  T1: "Tier 1 (official)",
  T2: "Tier 2",
  T3: "Tier 3 (news)",
  M: "Manual",
};

export function lineLabel(l: string | null | undefined): string {
  return l ? (LINE_LABEL[l] ?? l) : "Other";
}

export function isLine(v: unknown): v is Line {
  return typeof v === "string" && (LINES as readonly string[]).includes(v);
}

/** One colour per line, derived from the brand teal and checked for contrast on the dark map and panels. */
export const LINE_COLOUR: Record<string, string> = {
  critical_power: "#E9B872",
  compute: "#86BCF5",
  capital: "#C5A8F5",
  powered_land: "#7FDCB8",
};
export const OTHER_COLOUR = "#9EC5B8";
export function lineColour(l: string | null | undefined): string {
  return (l && LINE_COLOUR[l]) || OTHER_COLOUR;
}
