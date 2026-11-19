// Plain-text email body → Apollo HTML. Pure (no Deno or network), so it is unit-tested from the console's tests.

export const BOOKING_URL = "https://calendar.app.google/UM14qXc4ZQqxewFYA";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Is this paragraph the signature block (Kuran's name, or a Nodus address/domain on a short block)? */
export function isSignature(p: string): boolean {
  const t = p.trim();
  if (!t) return false;
  const lines = t.split("\n");
  return lines.length <= 8 && /Kuran Sailopal|nodus\.(partners|equipment)|Book a meeting/i.test(t);
}

/**
 * Links in the signature only: the Nodus email addresses become mailto links, the bare domains https links, and
 * "Book a meeting" (or a raw Google calendar booking URL, which it replaces) the booking link. Input is plain text;
 * the output is escaped HTML.
 */
export function linkifySignature(text: string): string {
  // A raw booking URL is shown as "Book a meeting" (unless that text is already there, in which case the URL goes).
  let t = text;
  const rawCal = /https?:\/\/calendar\.(?:app\.google|google\.com)\/[^\s|]*/gi;
  if (rawCal.test(t)) {
    rawCal.lastIndex = 0;
    t = /Book a meeting/i.test(t) ? t.replace(rawCal, "").replace(/[ \t]*\|[ \t]*(?=\n|$)/g, "").replace(/(^|\n)[ \t]*\|[ \t]*/g, "$1") : t.replace(rawCal, "Book a meeting");
  }
  const tokens: string[] = [];
  const hold = (html: string) => `\u0000${tokens.push(html) - 1}\u0000`;
  t = t.replace(/\b([a-z0-9._%+-]+@nodus\.(?:partners|equipment))\b/gi, (_m, e: string) => hold(`<a href="mailto:${esc(e)}">${esc(e)}</a>`));
  t = t.replace(/(^|[\s|(])((?:www\.)?nodus\.(?:partners|equipment))(?![\w@.-]*@)\b/gi, (_m, pre: string, d: string) => `${pre}${hold(`<a href="https://${esc(d.toLowerCase())}">${esc(d)}</a>`)}`);
  t = t.replace(/Book a meeting/gi, (m) => hold(`<a href="${BOOKING_URL}">${esc(m)}</a>`));
  return esc(t).replace(/\u0000(\d+)\u0000/g, (_m, i: string) => tokens[Number(i)]);
}

/** Plain text to Apollo's HTML: one <p> per paragraph, single line breaks kept; links only in the closing signature. */
export function toHtml(text: string): string {
  const paras = text.trim().split(/\n\s*\n/).map((p) => p.trim());
  const last = paras.length - 1;
  return paras.map((p, i) => {
    const inner = i === last && isSignature(p) ? linkifySignature(p) : esc(p);
    return `<p>${inner.replace(/\n/g, "<br>")}</p>`;
  }).join("");
}
