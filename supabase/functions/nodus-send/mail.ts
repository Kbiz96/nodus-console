// Pure helpers for nodus-send (no Deno or network), unit-tested from the console's tests.
// Which address a draft goes from, and the raw RFC 822 work: base64url, From rewriting, building a message.
import { toHtml } from "../nodus-apollo/html.ts";

export const FROM_CAPITAL = "kuran@nodus.partners";
export const FROM_DEFAULT = "info@nodus.equipment";
export const FROM_NAME = "Kuran Sailopal";
export const ALLOWED_FROM = [FROM_CAPITAL, FROM_DEFAULT];

/** Personal mailboxes are not a company: two people at gmail.com are not a clash. */
export const GENERIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "yahoo.com", "yahoo.co.uk",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
]);

export type Lane = "capital" | "other";

/**
 * Capital goes from kuran@nodus.partners; everything else (compute, GPUs, financing, sites, equipment, RFQs) from
 * info@nodus.equipment. Equipment words win first, then the priority's line, then capital words in the text.
 */
export function pickLane(text: string, line: string | null): Lane {
  const t = (text ?? "").toLowerCase();
  if (line === "critical_power" || /\b(rfq|procurement|genset|gensets|turbine|turbines|equipment|quote|bom)\b/.test(t)) return "other";
  if (line === "capital") return "capital";
  if (line && line !== "capital") return /\b(investor|investors|lp|lps|co-invest|family office)\b/.test(t) ? "capital" : "other";
  return /\b(investor|investors|capital partner|capital partners|fund|funds|equity|lp|lps|allocation|co-invest|convertible|family office|interconnect)\b/.test(t)
    ? "capital"
    : "other";
}

export const fromFor = (lane: Lane) => (lane === "capital" ? FROM_CAPITAL : FROM_DEFAULT);

export function domainOf(email: string | null | undefined): string | null {
  const m = (email ?? "").trim().toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})$/);
  return m ? m[1] : null;
}

// ---------- base64url over bytes ----------

export function b64urlEncodeBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64urlDecodeBytes(s: string): Uint8Array {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const latin1 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return s; };
const fromLatin1 = (s: string) => { const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 0xff; return o; };
const utf8 = (s: string) => new TextEncoder().encode(s);

/** RFC 2047 for non-ASCII header text (subjects, names). */
export function encodeHeaderWord(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${btoa(latin1(utf8(s)))}?=`;
}

/**
 * Sets the From header of a raw message (base64url, as Gmail returns it with format=raw) to `name <address>`,
 * replacing any existing From (folded continuation lines included). The body bytes are left untouched.
 */
export function rewriteFrom(rawB64url: string, address: string, name = FROM_NAME): string {
  const s = latin1(b64urlDecodeBytes(rawB64url));
  let split = s.indexOf("\r\n\r\n");
  let nl = "\r\n";
  if (split < 0) { split = s.indexOf("\n\n"); nl = "\n"; }
  const head = split < 0 ? s : s.slice(0, split);
  const rest = split < 0 ? "" : s.slice(split);
  const lines = head.split(nl);
  const kept: string[] = [];
  let skipping = false;
  for (const l of lines) {
    if (/^from:/i.test(l)) { skipping = true; continue; }
    if (skipping && /^[ \t]/.test(l)) continue;
    skipping = false;
    kept.push(l);
  }
  kept.unshift(`From: ${encodeHeaderWord(name)} <${address}>`);
  return b64urlEncodeBytes(fromLatin1(kept.join(nl) + rest));
}

/** The From address in a header value such as `Kuran Sailopal <kuran@nodus.partners>`. */
export function addressIn(headerValue: string | null | undefined): string | null {
  const v = (headerValue ?? "").trim();
  const m = v.match(/<([^>]+)>/) ?? v.match(/([^\s<>"]+@[^\s<>"]+)/);
  return m ? m[1].toLowerCase() : null;
}

/** Wraps base64 at 76 characters for a MIME part. */
const wrap76 = (s: string) => s.replace(/(.{76})/g, "$1\r\n");

/**
 * A new message from the outreach row: multipart/alternative (plain text and HTML, the signature's links live),
 * optionally as a reply in an existing thread. Returns base64url, ready for Gmail's `raw`.
 */
export function buildMessage(m: {
  from: string; to: string; toName?: string | null; subject: string; body: string; inReplyTo?: string | null; references?: string | null;
  boundary?: string;
}): string {
  const boundary = m.boundary ?? `nodus_${crypto.randomUUID().replace(/-/g, "")}`;
  const to = m.toName ? `${encodeHeaderWord(m.toName.replace(/[<>"]/g, ""))} <${m.to}>` : m.to;
  const head = [
    `From: ${encodeHeaderWord(FROM_NAME)} <${m.from}>`,
    `To: ${to}`,
    `Subject: ${encodeHeaderWord(m.subject)}`,
    "MIME-Version: 1.0",
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`, `References: ${m.references || m.inReplyTo}`] : []),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${toHtml(m.body)}</div>`;
  const part = (type: string, text: string) =>
    [`--${boundary}`, `Content-Type: ${type}; charset="UTF-8"`, "Content-Transfer-Encoding: base64", "", wrap76(btoa(latin1(utf8(text))))].join("\r\n");
  const raw = [head.join("\r\n"), "", part("text/plain", m.body.trim()), part("text/html", html), `--${boundary}--`, ""].join("\r\n");
  return b64urlEncodeBytes(fromLatin1(raw));
}

/** UK midnight today as an ISO string (the daily cap counts from here). */
export function ukMidnightIso(now = new Date()): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  // Offset of London at that moment: 0 in winter, +1 in summer.
  const londonHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(now)) % 24;
  const offset = (londonHour - now.getUTCHours() + 24) % 24;
  return new Date(Date.parse(`${day}T00:00:00Z`) - offset * 3600_000).toISOString();
}
