// NodusX requests: one record of every request that comes in (website "Request for NX-…", emails to nodusx@, RFQs that
// quote a lot), with where each one stands and the reply that fits it. Pure helpers, unit-tested; no network here.
// Requests live in board_listings: website ones as the site writes them, email ones added from the console with
// source "nodusx-request". Progress is kept in spec.req so nothing else in the table changes.

import { firstName, summarise, type NxListing } from "./nodusx.ts";

export const CALL_LINK = "https://calendar.app.google/UM14qXc4ZQqxewFYA";
export const REQUEST_SOURCE = "nodusx-request";

export type ReqStatus = "new" | "replied" | "call" | "screening" | "options" | "nda" | "won" | "closed";
export const REQ_STATUS: { key: ReqStatus; label: string; open: boolean }[] = [
  { key: "new", label: "New, reply owed", open: true },
  { key: "replied", label: "Replied", open: true },
  { key: "call", label: "Call booked", open: true },
  { key: "screening", label: "Screening", open: true },
  { key: "options", label: "Options sent", open: true },
  { key: "nda", label: "NDA / NCNDA", open: true },
  { key: "won", label: "Won", open: false },
  { key: "closed", label: "Closed", open: false },
];

export interface ReqState { status?: ReqStatus; gmail?: string; next?: string; updated?: string }
export type ReplyKind = "lot" | "info" | "screen";

const REF_RE = /\bNX-\d{1,4}\b/i;

function spec(l: Pick<NxListing, "spec">): Record<string, unknown> {
  return (l.spec ?? {}) as Record<string, unknown>;
}

/** The lot a request is about, if it names one: spec.request_of, else "NX-28" in their note. */
export function requestedRef(l: Pick<NxListing, "spec" | "note" | "note_original">): string | null {
  const s = spec(l).request_of;
  if (typeof s === "string" && REF_RE.test(s)) return s.match(REF_RE)![0].toUpperCase();
  const m = `${l.note_original ?? ""} ${l.note ?? ""}`.match(REF_RE);
  return m ? m[0].toUpperCase() : null;
}

/** True for anything that is a request rather than a listing to screen. */
export function isRequest(l: Pick<NxListing, "source" | "origin" | "spec" | "note" | "note_original">): boolean {
  if ((l.source ?? "").toLowerCase().includes("request")) return true;
  if ((l.origin ?? "").toLowerCase().includes("request")) return true;
  if (typeof spec(l).request_of === "string") return true;
  return /^\s*re[:\s]+NX-\d+/i.test(l.note_original ?? l.note ?? "");
}

export function reqState(l: Pick<NxListing, "spec">): ReqState {
  const r = spec(l).req;
  return r && typeof r === "object" ? (r as ReqState) : {};
}

export function reqStatus(l: Pick<NxListing, "spec">): ReqStatus {
  return reqState(l).status ?? "new";
}

export function isOpen(l: Pick<NxListing, "spec">): boolean {
  return REQ_STATUS.find((s) => s.key === reqStatus(l))?.open ?? true;
}

/** Which reply fits: a named lot gets the options; a thin request gets questions; a full one gets "we'll screen". */
export function replyKind(l: Pick<NxListing, "spec" | "note" | "note_original" | "gpus" | "mw" | "market" | "timing">): ReplyKind {
  if (requestedRef(l)) return "lot";
  const known = [l.gpus || l.mw, l.market && !/^unspecified$/i.test(l.market), l.timing].filter(Boolean).length;
  const note = (l.note_original ?? l.note ?? "").trim();
  return known >= 3 && note.length >= 40 ? "screen" : "info";
}

/** Live supply lines that could answer a request, the named lot first, then same GPU model, then by size. */
export function optionsFor(req: Pick<NxListing, "kind" | "gpu_model" | "spec" | "note" | "note_original">, live: NxListing[]): NxListing[] {
  const ref = requestedRef(req);
  const model = (req.gpu_model ?? "").toUpperCase();
  return live
    .filter((l) => l.side === "have" && (l.status === "approved" || l.status === "verified") && l.kind === req.kind)
    .filter((l) => !model || !l.gpu_model || l.gpu_model.toUpperCase() === model || l.ref === ref)
    .sort((a, b) => Number(b.ref === ref) - Number(a.ref === ref) || (b.gpus ?? 0) - (a.gpus ?? 0))
    .slice(0, 6);
}

const SIGN = "Kind regards,\n\nKuran Sailopal\nDirector, Nodus Partners\nkuran@nodus.partners | WhatsApp: +44 7501 980345\nnodus.partners/nodusx";
const CALL = `Happy to discuss in more detail. Pick any time here: ${CALL_LINK}`;

/** The reply text for a request. Kuran edits it before it goes. Never names operators or prices. */
export function replyText(l: NxListing, kind: ReplyKind, live: NxListing[] = []): { subject: string; body: string } {
  const hi = firstName(l);
  const ref = requestedRef(l);
  const what = summarise(l);
  const subject = ref ? `Re: Your NodusX request for ${ref}` : "Re: Your NodusX request";
  if (kind === "lot") {
    const opts = optionsFor(l, live);
    const lines = opts.length
      ? opts.map((o, i) => `${i + 1}. ${o.ref ?? "Unlisted"}: ${summarise({ ...o, side: "have" }).replace(/^Supply[^:]*: /, "")}`).join("\n")
      : "1. " + (ref ?? "The lot you asked about");
    return {
      subject,
      body: `Hi ${hi},\n\nThank you for your request${ref ? ` on ${ref}` : ""}. These are the options on our desk that fit:\n\n${lines}\n\nIndicative pricing and deposit terms are shared on a call or under NDA; operator and site names follow the NDA.\n\nTo narrow it down, could you tell us the contracting entity and your role with the end user, the term, your target price per GPU-hour, and whether a split start or another region would work?\n\n${CALL}\n\n${SIGN}`,
    };
  }
  if (kind === "info") {
    return {
      subject,
      body: `Hi ${hi},\n\nThank you for your request${what ? `:\n${what}` : "."}\n\nSo we can screen it properly, could you send:\n- GPU model and quantity (or MW for space)\n- Preferred location, and any that are ruled out\n- Ready-for-service date and term\n- Target price, and the deposit you can support\n- The contracting entity and your role with the end user\n\n${CALL}\n\n${SIGN}`,
    };
  }
  return {
    subject,
    body: `Hi ${hi},\n\nThank you, that gives us what we need:\n${what}\n\nWe're screening our network against it now and will come back with the options that fit. Names on both sides are shared under an NCNDA.\n\n${CALL}\n\n${SIGN}`,
  };
}

/** A Gmail compose link with the reply filled in, for when there is no thread link. */
export function composeLink(to: string, subject: string, body: string): string {
  const q = new URLSearchParams({ view: "cm", fs: "1", to, su: subject, body });
  return `https://mail.google.com/mail/?${q.toString()}`;
}
