// Links that open a new Claude chat inside the Nodus project with the instruction already typed in.
// Every claude.ai link the console builds goes through here. Pure functions only, so they can be unit-tested.

import { NODUS_PROJECT_ID } from "../config.ts";

/** Keep links comfortably under the length browsers and claude.ai accept. */
export const CLAUDE_URL_MAX = 7500;

/** What the chat opens with when the full instruction is too long for a link (it is on the clipboard instead). */
export const CLAUDE_PASTE_NOTE =
  "Nodus command: the full instruction is on my clipboard and is too long for the link. Wait for me to paste it, then follow it.";

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
  /** False when the text was too long: the link carries a short note and the full text must be pasted. */
  full: boolean;
}

/** A link to a new chat in the Nodus project, with a fallback note when the text would make the link too long. */
export function claudeLink(text: string, projectId = NODUS_PROJECT_ID, max = CLAUDE_URL_MAX): ClaudeLink {
  const url = build(withCheckFirst(text), projectId);
  if (url.length <= max) return { url, full: true };
  return { url: build(CLAUDE_PASTE_NOTE, projectId), full: false };
}

/** Opens a new Claude chat in the Nodus project with the text already typed in. */
export function claudeUrl(text: string): string {
  return claudeLink(text).url;
}
