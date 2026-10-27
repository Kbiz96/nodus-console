// Links that open a new Claude chat inside the Nodus project with the instruction already typed in.
// Every claude.ai link the console builds goes through here. Pure functions only, so they can be unit-tested.

import { NODUS_PROJECT_ID } from "../config.ts";

/** Keep links comfortably under the length browsers and claude.ai accept. */
export const CLAUDE_URL_MAX = 7500;

/** Added when an instruction is too long for a link and had to be shortened. Nothing is ever pasted from the clipboard. */
export const CLAUDE_CUT_NOTE =
  "[The rest of this instruction was cut to fit the link. Look up what is missing in the CRM and outreach tables before acting, and say what you looked up.]";

/**
 * Kuran's standing rule (26 Oct): before doing anything, look for what has already been done and build on it.
 * Added to every "Nodus command" the console sends, so each chat starts by checking.
 */
export const CHECK_FIRST =
  "Before doing anything: search what has already been done on this (CRM contacts, notes and crm_actions, deals, " +
  "every outreach row for these people or companies including parked ones, project docs, Gmail threads and past chats). " +
  "Reuse or improve what exists instead of starting again, never duplicate a message, and tell me in one line what you found.";

export function withCheckFirst(text: string): string {
  if (!text.startsWith("Nodus command") || text.includes(CHECK_FIRST)) return text;
  return `${text}\n\n${CHECK_FIRST}`;
}

function build(text: string, projectId: string): string {
  return `https://claude.ai/new?q=${encodeURIComponent(text)}&project=${encodeURIComponent(projectId)}`;
}

export interface ClaudeLink {
  url: string;
  /** False when the text was too long and its end was cut (with a note saying so). There is never a paste step. */
  full: boolean;
}

/**
 * A link to a new chat in the Nodus project. When the instruction would make the link too long, its end is cut
 * (the opening instruction and the check-first line always survive) and a note tells Claude to look up the rest.
 */
export function claudeLink(text: string, projectId = NODUS_PROJECT_ID, max = CLAUDE_URL_MAX): ClaudeLink {
  const full = withCheckFirst(text);
  const url = build(full, projectId);
  if (url.length <= max) return { url, full: true };
  const tail = text.startsWith("Nodus command") ? `\n\n${CHECK_FIRST}` : "";
  const fits = (n: number) => build(`${text.slice(0, n).trimEnd()}\n\n${CLAUDE_CUT_NOTE}${tail}`, projectId).length <= max;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  // Prefer cutting at the end of a line so no list item is half there.
  const nl = text.lastIndexOf("\n", lo);
  const n = nl > lo * 0.6 ? nl : lo;
  return { url: build(`${text.slice(0, n).trimEnd()}\n\n${CLAUDE_CUT_NOTE}${tail}`, projectId), full: false };
}

/** Opens a new Claude chat in the Nodus project with the text already typed in. */
export function claudeUrl(text: string): string {
  return claudeLink(text).url;
}
