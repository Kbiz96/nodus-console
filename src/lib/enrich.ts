// Step 11 enrichment: plain-English labels and the pure helpers behind the People panel and the Spend page.
// Nothing here talks to the database; see data.ts for the calls.
import { fmtDate, fmtNumber } from "./format.ts";

/** One result from the enrich_request database function (one per opportunity). */
export interface EnrichResult {
  opportunity: string;
  ok: boolean;
  why: string;
  request?: string;
}

/** What person_crm_mark returns: the details for Kuran to paste into his CRM himself. */
export interface CrmDetails {
  name: string | null;
  role: string | null;
  organisation: string | null;
  email: string | null;
  email_status: string | null;
  phone: string | null;
  linkedin: string | null;
  source: string | null;
  retrieved_at: string | null;
  lawful_basis: string | null;
  opportunity: string | null;
}

export const PROVIDER_LABEL: Record<string, string> = {
  apollo: "Apollo",
  clay: "Clay",
  vibe: "Vibe Prospecting",
  public: "Public document",
};

export const EMAIL_STATUS_LABEL: Record<string, string> = {
  verified: "Verified",
  catch_all: "Catch-all: may not reach",
  unknown: "Unknown",
};

export const REQUEST_STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  needs_approval: "Waiting for your approval",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

export const ORIGIN_LABEL: Record<string, string> = {
  console: "You (console)",
  auto: "Daily top 10",
  cli: "Command line",
};

export function providerLabel(p: string | null | undefined): string {
  return p ? (PROVIDER_LABEL[p] ?? p) : "—";
}

/** True while a request is still open, so another Enrich click would only duplicate it. */
export function isOpenRequest(status: string | null | undefined): boolean {
  return status === "pending" || status === "needs_approval";
}

/** Credits to approve for a request waiting on Kuran: the engine's estimate, kept within 1–200. */
export function creditsToApprove(estimated: number | null | undefined, fallback: number): number {
  const n = Math.round(Number(estimated));
  const v = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.max(1, Math.min(200, v));
}

/** The CRM details as tidy text to paste. Empty fields are left out. */
export function crmText(d: CrmDetails): string {
  const email = d.email ? `${d.email}${d.email_status ? ` (${EMAIL_STATUS_LABEL[d.email_status] ?? d.email_status})` : ""}` : null;
  const source = d.source ? `${providerLabel(d.source)}${d.retrieved_at ? `, retrieved ${fmtDate(d.retrieved_at)}` : ""}` : null;
  const rows: [string, string | null][] = [
    ["Name", d.name],
    ["Role", d.role],
    ["Organisation", d.organisation],
    ["Email", email],
    ["Phone", d.phone],
    ["LinkedIn", d.linkedin],
    ["Source", source],
    ["Lawful basis", d.lawful_basis],
    ["Nodus reference", d.opportunity],
  ];
  return rows
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => `${k}: ${String(v).trim()}`)
    .join("\n");
}

/** Escape a vCard text value (RFC 6350): backslash, comma, semicolon and new lines. */
function vEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/** Fold a vCard line at 75 characters; continuation lines start with a space. */
function vFold(line: string): string {
  const chars = Array.from(line);
  if (chars.length <= 75) return line;
  const out: string[] = [chars.slice(0, 75).join("")];
  for (let i = 75; i < chars.length; i += 74) out.push(` ${chars.slice(i, i + 74).join("")}`);
  return out.join("\r\n");
}

/** Split a full name into vCard family name (last word) and given names (the rest). */
function splitName(full: string): { family: string; given: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { family: parts[0] ?? "", given: "" };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
}

/** A vCard 3.0 contact card for the CRM details (opens in Outlook, Apple Contacts, Google Contacts and most CRMs). */
export function buildVCard(d: CrmDetails): string {
  const name = (d.name ?? "").trim() || "Unknown";
  const { family, given } = splitName(name);
  const note = [
    d.source ? `Source: ${providerLabel(d.source)}${d.retrieved_at ? `, retrieved ${fmtDate(d.retrieved_at)}` : ""}` : null,
    d.lawful_basis ? `Lawful basis: ${d.lawful_basis}` : null,
    d.email && d.email_status ? `Email status: ${EMAIL_STATUS_LABEL[d.email_status] ?? d.email_status}` : null,
    d.opportunity ? `Nodus reference: ${d.opportunity}` : null,
  ].filter((x): x is string => Boolean(x));
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${vEscape(family)};${vEscape(given)};;;`,
    `FN:${vEscape(name)}`,
    d.organisation ? `ORG:${vEscape(d.organisation)}` : null,
    d.role ? `TITLE:${vEscape(d.role)}` : null,
    d.email ? `EMAIL;TYPE=INTERNET,WORK:${vEscape(d.email)}` : null,
    d.phone ? `TEL;TYPE=WORK,VOICE:${vEscape(d.phone)}` : null,
    d.linkedin ? `URL:${d.linkedin}` : null,
    note.length ? `NOTE:${vEscape(note.join("\n"))}` : null,
    "END:VCARD",
  ].filter((x): x is string => x !== null);
  return `${lines.map(vFold).join("\r\n")}\r\n`;
}

/** File name for a contact card, e.g. jane-smith.vcf. */
export function vcfFilename(name: string | null | undefined): string {
  const slug = (name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "contact"}.vcf`;
}

export interface SpendRow {
  at: string;
  provider: string;
  credits: number | string;
  opportunity_id: string | null;
}

export interface SpendSummary {
  total: number;
  byProvider: { provider: string; credits: number; actions: number }[];
  byOpportunity: { opportunityId: string | null; credits: number; last: string }[];
}

/** Totals for the Spend page: overall, by provider and by opportunity (largest first). */
export function summariseSpend(rows: SpendRow[]): SpendSummary {
  const prov = new Map<string, { credits: number; actions: number }>();
  const opp = new Map<string, { opportunityId: string | null; credits: number; last: string }>();
  let total = 0;
  for (const r of rows) {
    const c = Number(r.credits) || 0;
    total += c;
    const p = prov.get(r.provider) ?? { credits: 0, actions: 0 };
    p.credits += c;
    p.actions += 1;
    prov.set(r.provider, p);
    const key = r.opportunity_id ?? "";
    const o = opp.get(key) ?? { opportunityId: r.opportunity_id, credits: 0, last: r.at };
    o.credits += c;
    if (+new Date(r.at) > +new Date(o.last)) o.last = r.at;
    opp.set(key, o);
  }
  return {
    total,
    byProvider: [...prov.entries()].map(([provider, v]) => ({ provider, ...v })).sort((a, b) => b.credits - a.credits || a.provider.localeCompare(b.provider)),
    byOpportunity: [...opp.values()].sort((a, b) => b.credits - a.credits || +new Date(b.last) - +new Date(a.last)),
  };
}

/** Credits shown to people: whole numbers where possible, e.g. "12" or "2.5". */
export function fmtCredits(n: number | string | null | undefined): string {
  return fmtNumber(n ?? 0, 2);
}
