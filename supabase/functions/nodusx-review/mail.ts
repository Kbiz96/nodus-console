// Pure helpers for nodusx-review: build one RFC 822 message (plain text + HTML) for Gmail's `raw`.
import { toHtml } from "./html.ts";

export const FROM_DEFAULT = "info@nodus.equipment";
export const FROM_NAME = "Kuran Sailopal";

const latin1 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return s; };
const fromLatin1 = (s: string) => { const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 0xff; return o; };
const utf8 = (s: string) => new TextEncoder().encode(s);

export function b64urlEncodeBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 2047 for non-ASCII header text (subjects, names). */
export function encodeHeaderWord(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${btoa(latin1(utf8(s)))}?=`;
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

