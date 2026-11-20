// NodusX screening desk: pure helpers (no network), unit-tested.
// Listings come in through nodus.partners/nodusx; nothing is published until Kuran approves it here.

export type NxStatus = "pending" | "info_requested" | "approved" | "verified" | "rejected" | "withdrawn" | "private";
export type NxDecision = "approve" | "verify" | "reject" | "info" | "withdraw" | "reopen" | "save";

export interface NxAgreement {
  id: string;
  created_at: string;
  role: string | null;
  terms_version: string | null;
  full_name: string | null;
  job_title: string | null;
  company: string | null;
  email: string | null;
  ip: string | null;
  signature_image: string | null;
}

export interface NxListing {
  id: string;
  created_at: string;
  side: "have" | "need";
  kind: string;
  mw: number | null;
  gpus: number | null;
  gpu_model: string | null;
  market: string;
  timing: string | null;
  note: string | null;
  note_original: string | null;
  email: string;
  company: string | null;
  role: string | null;
  status: NxStatus;
  origin: string | null;
  source: string | null;
  deal: string | null;
  spec: Record<string, string> | null;
  ref: string | null;
  crm_contact_id: string | null;
  diligence: Record<string, boolean | string> | null;
  review_note: string | null;
  reject_reason: string | null;
  info_requested: string | null;
  reviewed_at: string | null;
  decision_emailed_at: string | null;
  decision_email: { subject?: string; decision?: string; at?: string } | null;
  agreement: NxAgreement | null;
  public_snapshot?: Record<string, unknown> | null;
  published_at?: string | null;
}

/** The checks Kuran runs before anything goes live. Keys are stored in board_listings.diligence. */
export const DILIGENCE: { key: string; label: string; hint: string }[] = [
  { key: "company", label: "Company is real", hint: "Website, Companies House or local registry, LinkedIn page." },
  { key: "person", label: "Person and authority", hint: "LinkedIn profile matches the name and title they signed with." },
  { key: "direct", label: "Direct party", hint: "Owner or operator of the capacity, or the end buyer, not a broker chain." },
  { key: "screening", label: "Not excluded", hint: "No China-linked or sanctioned party, not on the exclusions list." },
  { key: "evidence", label: "Capacity or need evidenced", hint: "RFS date, contract, purchase order, photos, or a call held." },
  { key: "specs", label: "Specs hang together", hint: "Configuration, node count, power and timing are consistent." },
  { key: "protected", label: "Paperwork in place", hint: "Signed NodusX terms on file; NCNDA or fee protection where needed." },
];

export const STATUS_LABEL: Record<NxStatus, string> = {
  pending: "To review",
  info_requested: "Info requested",
  approved: "Live",
  verified: "Live, verified",
  rejected: "Declined",
  withdrawn: "Withdrawn",
  private: "Private brief",
};

export const QUEUES: { key: string; label: string; statuses: NxStatus[] }[] = [
  { key: "review", label: "To review", statuses: ["pending", "info_requested"] },
  { key: "briefs", label: "Private briefs", statuses: ["private"] },
  { key: "live", label: "Live", statuses: ["approved", "verified"] },
  { key: "closed", label: "Closed", statuses: ["rejected", "withdrawn"] },
];

const fmtInt = (n: number) => n.toLocaleString("en-GB");

/** One line: what it is, how big, where, when. */
export function summarise(l: Pick<NxListing, "side" | "kind" | "mw" | "gpus" | "gpu_model" | "market" | "timing" | "deal" | "spec">): string {
  const side = l.side === "have" ? "Supply" : "Requirement";
  const size = l.kind === "capacity" && l.mw
    ? `${fmtInt(Math.round(l.mw * 1000))} kW`
    : l.gpus
      ? `${l.spec?.nodes ? `${l.spec.nodes} nodes, ` : ""}${fmtInt(l.gpus)} ${l.gpu_model ?? "GPUs"}`
      : l.mw ? `${l.mw} MW` : "";
  const deal = l.deal ? ` ${l.deal.toLowerCase()}` : "";
  return [`${side}${deal}: ${size}`.trim(), l.market, l.timing].filter(Boolean).join(" · ");
}

/** Plain first name from the signed name, else the email. */
export function firstName(l: Pick<NxListing, "email" | "agreement">): string {
  const n = l.agreement?.full_name?.trim().split(/\s+/)[0];
  if (n && n.length > 1) return n.charAt(0).toUpperCase() + n.slice(1);
  const local = l.email.split("@")[0].split(/[._-]/)[0];
  return local.length > 1 && !/^(info|sales|hello|contact|admin|ops|team)$/i.test(local) ? local.charAt(0).toUpperCase() + local.slice(1) : "Hello";
}

export const SIGNATURE = "Kuran Sailopal\nDirector, Nodus Partners\nnodus.partners | nodusx@nodus.partners";

/** Words that never go in a decision email (fees, prices). Used as a last check before sending. */
export function forbiddenWords(text: string): string[] {
  const hits = text.match(/\b(fee|fees|commission|success fee|retainer)\b|\$\s?\d|per gpu[- ]hour|\/gpu-hr/gi) ?? [];
  return [...new Set(hits.map((h) => h.toLowerCase()))];
}

export interface Draft { to: string; subject: string; body: string }

/** The email that goes with a decision. Kuran edits it in the console before it is sent. */
export function decisionEmail(l: NxListing, decision: NxDecision, opts: { ref?: string | null; reason?: string; info?: string } = {}): Draft | null {
  const hi = firstName(l);
  const what = summarise(l);
  const ref = opts.ref ?? l.ref;
  const to = l.email;
  switch (decision) {
    case "approve":
    case "verify":
      return {
        to,
        subject: `Your NodusX listing is live${ref ? `: ${ref}` : ""}`,
        body: `${hi},\n\nYour listing is now live on NodusX${ref ? ` as ${ref}` : ""}:\n${what}\n\nIt shows anonymised, with no company name or contact details. When a ${l.side === "have" ? "buyer" : "supplier"} fits, we confirm fit and interest with both sides before anyone is introduced.\n\nTo update it or take it down, reply to this email.\n\n${SIGNATURE}`,
      };
    case "info":
      return {
        to,
        subject: "NodusX: a few details before we list",
        body: `${hi},\n\nThanks for your submission:\n${what}\n\nBefore it goes live we need:\n${(opts.info ?? "").trim() || "- "}\n\nReply here and we will publish once it is screened.\n\n${SIGNATURE}`,
      };
    case "reject":
      return {
        to,
        subject: "Your NodusX submission",
        body: `${hi},\n\nThanks for submitting to NodusX:\n${what}\n\nWe are not able to list this one at present${opts.reason?.trim() ? `: ${opts.reason.trim().replace(/\.$/, "")}` : ""}. If anything changes, reply here and we will look again.\n\n${SIGNATURE}`,
      };
    case "withdraw":
      return {
        to,
        subject: `Your NodusX listing has been taken down${ref ? `: ${ref}` : ""}`,
        body: `${hi},\n\nAs requested, your listing is no longer on NodusX:\n${what}\n\nIf you would like it back up, or have new capacity or requirements, reply here.\n\n${SIGNATURE}`,
      };
    default:
      return null;
  }
}

/** Public note checks: nothing that names the party. Returns warnings, empty when clean. */
export function publicNoteWarnings(note: string, l: Pick<NxListing, "company" | "email" | "agreement">): string[] {
  const w: string[] = [];
  const t = note.toLowerCase();
  if (note.length > 160) w.push("Over 160 characters: it will be cut.");
  const names = [l.company, l.agreement?.company, l.agreement?.full_name, l.email.split("@")[1]?.split(".")[0]]
    .filter((x): x is string => Boolean(x && x.trim().length > 2))
    .map((x) => x.toLowerCase().trim());
  for (const n of names) if (t.includes(n)) w.push(`Mentions "${n}": names are never public.`);
  if (/@|https?:\/\/|www\./i.test(note)) w.push("Contains an email or web address.");
  if (/\b(street|road|avenue|postcode|zip)\b/i.test(note)) w.push("Looks like an address.");
  return w;
}

/** Days since a date, for "waiting 3 days". */
export function ageDays(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000));
}

/** Fields the public board shows. Live edits stay internal until Kuran publishes them. */
const PUB_KEYS = ["side", "kind", "mw", "gpus", "gpu_model", "market", "timing", "note", "deal"] as const;
const norm = (v: unknown) => (v === undefined || v === "" ? null : typeof v === "number" ? Number(v) : v);
export function unpublishedChanges(l: NxListing): string[] {
  if (l.status !== "approved" && l.status !== "verified") return [];
  const snap = l.public_snapshot;
  if (!snap) return ["everything (never published)"];
  const out: string[] = PUB_KEYS.filter((k) => String(norm((l as unknown as Record<string, unknown>)[k])) !== String(norm(snap[k])));
  const strip = (o: unknown) => { const x = { ...((o as Record<string, unknown>) ?? {}) }; delete x.party; delete x.party_note; return JSON.stringify(Object.keys(x).sort().map((k) => [k, x[k]])); };
  if (strip(l.spec) !== strip(snap.spec)) out.push("spec");
  return out;
}
