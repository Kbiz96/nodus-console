// Gate rules, mirrored from the database function gate_advance (migration 0006).
// Used only to explain things up front; the database always has the final say.

export const GATE_ORDER = ["unverified", "qualified", "protected", "verified", "introduced"] as const;
export type GateName = (typeof GATE_ORDER)[number];

export function nextGate(current: string): GateName | null {
  const i = GATE_ORDER.indexOf(current as GateName);
  return i >= 0 && i < GATE_ORDER.length - 1 ? GATE_ORDER[i + 1] : null;
}

export function gateIndex(g: string): number {
  return GATE_ORDER.indexOf(g as GateName);
}

export function needsConfirmation(to: string): boolean {
  return to === "protected" || to === "verified" || to === "introduced";
}

export const CONFIRM_TEXT: Record<string, string> = {
  protected: "I confirm the NCNDA and fee protection are signed",
  verified: "I confirm the facts have been verified",
  introduced: "I confirm the parties have been introduced",
};

/** A reason the next step is not possible yet, known before asking the database; otherwise null. */
export function gateBlocker(o: {
  line: string;
  side: string;
  specs: Record<string, unknown> | null;
  gate: string;
  orgSanctions: string | null; // null = no organisation linked
}): string | null {
  const next = nextGate(o.gate);
  if (!next) return "This opportunity is already at the last step.";
  if (next === "qualified" && o.line === "compute" && o.side === "supply" && !o.specs?.chain_of_title) {
    return "Compute supply needs a chain of title (proof the seller owns the kit) before it can be qualified.";
  }
  if (next === "introduced" && o.orgSanctions !== "clear") {
    return o.orgSanctions === null
      ? "No organisation is linked, so a sanctions check cannot be confirmed. It cannot be introduced."
      : "The organisation is not sanctions-clear, so it cannot be introduced.";
  }
  return null;
}

/** The database shows plain-English messages; strip Postgres prefixes if any slipped through. */
export function friendlyError(e: unknown): string {
  const raw =
    typeof e === "string" ? e : e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";
  const msg = raw.replace(/^ERROR:\s*/i, "").trim();
  if (!msg) return "That did not work. Please try again.";
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return "Could not reach the database. Please check your internet connection and try again.";
  }
  if (/JWT expired|invalid jwt/i.test(msg)) return "Your sign-in has expired. Please sign in again.";
  return msg;
}

/** True when an error means the signed-in account is not on the approved list. */
export function isNotAllowed(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const x = e as { code?: string; message?: string };
  return x.code === "42501" || /^not allowed/i.test(x.message ?? "") || /permission denied/i.test(x.message ?? "");
}
