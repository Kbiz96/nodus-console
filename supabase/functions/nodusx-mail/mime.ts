// Pure MIME helpers for NodusX customer mail (no Deno or network): one message with plain text, HTML and optional
// attachments, as base64url for Gmail's `raw`.

export const NODUSX_FROM = "nodusx@nodus.partners";
export const FALLBACK_FROM = "info@nodus.equipment";

const latin1 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return s; };
const fromLatin1 = (s: string) => { const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 0xff; return o; };
const utf8 = (s: string) => new TextEncoder().encode(s);
const wrap76 = (s: string) => s.replace(/(.{76})/g, "$1\r\n");
export const b64 = (s: string) => btoa(latin1(utf8(s)));

export function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 2047 for non-ASCII header text. */
export function hw(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;
}

/** A display name for From: quoted when plain ASCII (commas would otherwise split it), encoded otherwise. */
export function displayName(s: string): string {
  const clean = s.replace(/["\\<>\r\n]/g, "");
  return /^[\x20-\x7e]*$/.test(clean) ? `"${clean}"` : hw(clean);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text to simple HTML: paragraphs, line breaks, and bare https links made clickable (direct, never wrapped). */
export function textToHtml(text: string): string {
  const paras = text.trim().split(/\n\s*\n/).map((p) =>
    esc(p).replace(/https:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u.replace(/^https:\/\//, "")}</a>`)
      .replace(/\b([a-z0-9._%+-]+@nodus\.(?:partners|equipment))\b/gi, '<a href="mailto:$1">$1</a>')
      .replace(/\n/g, "<br>"));
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${paras.map((p) => `<p>${p}</p>`).join("")}</div>`;
}

export interface Attachment { filename: string; mime: string; content_b64: string }

export function buildMime(m: {
  fromName: string; from: string; to: string; cc?: string[]; replyTo?: string; subject: string; text: string; html?: string;
  attachments?: Attachment[];
}): string {
  const alt = `alt_${crypto.randomUUID().replace(/-/g, "")}`;
  const mix = `mix_${crypto.randomUUID().replace(/-/g, "")}`;
  const part = (type: string, body: string, boundary: string) =>
    [`--${boundary}`, `Content-Type: ${type}; charset="UTF-8"`, "Content-Transfer-Encoding: base64", "", wrap76(b64(body))].join("\r\n");
  const altBody = [part("text/plain", m.text.trim(), alt), part("text/html", m.html ?? textToHtml(m.text), alt), `--${alt}--`].join("\r\n");
  const atts = (m.attachments ?? []).filter((a) => a.filename && a.content_b64);
  const head = [
    `From: ${displayName(m.fromName)} <${m.from}>`,
    `To: ${m.to}`,
    ...(m.cc?.length ? [`Cc: ${m.cc.join(", ")}`] : []),
    ...(m.replyTo ? [`Reply-To: ${m.replyTo}`] : []),
    `Subject: ${hw(m.subject)}`,
    "MIME-Version: 1.0",
  ];
  let raw: string;
  if (!atts.length) {
    raw = [...head, `Content-Type: multipart/alternative; boundary="${alt}"`, "", altBody, ""].join("\r\n");
  } else {
    const files = atts.map((a) => [
      `--${mix}`, `Content-Type: ${/^[\w.+-]+\/[\w.+-]+$/.test(a.mime) ? a.mime : "application/octet-stream"}; name="${a.filename.replace(/"/g, "")}"`, "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${a.filename.replace(/"/g, "")}"`, "", wrap76(a.content_b64.replace(/\s/g, "")),
    ].join("\r\n"));
    raw = [...head, `Content-Type: multipart/mixed; boundary="${mix}"`, "", `--${mix}`, `Content-Type: multipart/alternative; boundary="${alt}"`, "", altBody, ...files, `--${mix}--`, ""].join("\r\n");
  }
  return b64url(fromLatin1(raw));
}
