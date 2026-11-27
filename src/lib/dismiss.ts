// Dismissed items (the X on cards and rows): Kuran clears things he has dealt with or does not want to focus on.
// Each one is a row in console_dismissals (kind + ref, unique). Dismissing hides the item from the console only;
// deal stages and contact data never change. The one exception: an email still waiting to go (draft or approved)
// is also set to "skipped" through outreach_decide, so it can never be sent by mistake and the counts drop.
// The set is loaded once per session (through the cache) and kept in memory; every change updates it at once.
import { supabase, must } from "./supabase.ts";
import { cached, invalidate } from "./cache.ts";
import { outreachChanged, outreachDecide } from "./data.ts";

export const DISMISS_KINDS = ["outreach", "deal", "contact", "brief_reply", "brief_focus", "mandate", "lead", "match", "other"] as const;
export type DismissKind = (typeof DISMISS_KINDS)[number];

export interface ConsoleDismissal {
  id: string;
  kind: DismissKind;
  ref: string;
  label: string | null;
  reason: string | null;
  dismissed_at: string;
}

/** What each kind is called on the Dismissed page. */
export const DISMISS_KIND_LABEL: Record<DismissKind, string> = {
  outreach: "Email or message",
  deal: "Deal",
  contact: "Contact",
  brief_reply: "Reply owed",
  brief_focus: "Plan item",
  mandate: "Mandate",
  lead: "Lead",
  match: "Match",
  other: "Other",
};

const COLS = "id,kind,ref,label,reason,dismissed_at";
const CACHE_KEY = "dismissals";
const EVENT = "nodus-dismissals-changed";

// ---------- pure rules (unit-tested) ----------

export function dismissKey(kind: DismissKind, ref: string): string {
  return `${kind}:${ref}`;
}

/** The items whose (kind, ref) is not in the dismissed set. The input is not changed. */
export function filterDismissed<T>(items: readonly T[], kind: DismissKind, refOf: (item: T) => string | null | undefined, dismissed: ReadonlySet<string>): T[] {
  if (dismissed.size === 0) return [...items];
  return items.filter((it) => {
    const ref = refOf(it);
    return !ref || !dismissed.has(dismissKey(kind, ref));
  });
}

/** Emails still waiting to go are also skipped when dismissed, so they can never be sent. */
export function skipsOnDismiss(status: string | null | undefined): boolean {
  return status === "draft" || status === "approved";
}

/** The reason stored when a dismissal also skipped an email ("skipped:draft"), so Restore can put it back. */
export function skippedReason(status: string): string {
  return `skipped:${status}`;
}

/** The status an email had before X skipped it, or null when the dismissal did not skip it. */
export function statusBeforeSkip(reason: string | null | undefined): "draft" | "approved" | null {
  const m = /^skipped:(draft|approved)$/.exec((reason ?? "").trim());
  return m ? (m[1] as "draft" | "approved") : null;
}

/** Newest first by dismissed_at (ties by id), for the Dismissed page. */
export function newestDismissed<T extends Pick<ConsoleDismissal, "id" | "dismissed_at">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.dismissed_at === b.dismissed_at ? (a.id < b.id ? 1 : -1) : a.dismissed_at < b.dismissed_at ? 1 : -1));
}

// ---------- the dismissed set, kept in memory ----------

let rows: Map<string, ConsoleDismissal> | null = null;
let loading: Promise<void> | null = null;

function emit(): void {
  invalidate(CACHE_KEY);
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* not in a browser */ }
}

async function fetchAll(): Promise<ConsoleDismissal[]> {
  const res = await supabase.from("console_dismissals").select(COLS).order("dismissed_at", { ascending: false }).limit(5000);
  if (res.error) {
    // Unreadable: nothing is hidden, and the console still works.
    console.warn("console_dismissals not readable:", res.error.message);
    return [];
  }
  return (res.data ?? []) as unknown as ConsoleDismissal[];
}

/** Load the dismissed set once per session (cached for ten minutes across reloads). `force` fetches fresh. */
export function loadDismissals(force = false): Promise<void> {
  if (rows && !force) return Promise.resolve();
  if (loading && !force) return loading;
  loading = cached(CACHE_KEY, fetchAll, { force }).then((list) => {
    rows = new Map(list.map((d) => [dismissKey(d.kind, d.ref), d]));
    loading = null;
    try { window.dispatchEvent(new Event(EVENT)); } catch { /* not in a browser */ }
  }, (e) => { loading = null; throw e; });
  return loading;
}

export function dismissalsReady(): boolean {
  return rows !== null;
}

export function isDismissed(kind: DismissKind, ref: string | null | undefined): boolean {
  return Boolean(ref && rows?.has(dismissKey(kind, ref)));
}

/** The keys ("kind:ref") of everything dismissed. */
export function dismissedKeys(): ReadonlySet<string> {
  return new Set(rows?.keys() ?? []);
}

/** Every dismissal, newest first. */
export function dismissalList(): ConsoleDismissal[] {
  return newestDismissed([...(rows?.values() ?? [])]);
}

export function dismissalOf(kind: DismissKind, ref: string): ConsoleDismissal | null {
  return rows?.get(dismissKey(kind, ref)) ?? null;
}

/** Record a dismissal. The item disappears at once; if the database refuses, it comes back and the error is thrown. */
export async function dismiss(kind: DismissKind, ref: string, label: string | null = null, reason: string | null = null): Promise<void> {
  if (!rows) rows = new Map();
  const k = dismissKey(kind, ref);
  const before = rows.get(k) ?? null;
  const row = { kind, ref, label: label ? label.slice(0, 300) : null, reason, dismissed_at: new Date().toISOString() };
  rows.set(k, { id: before?.id ?? `pending-${k}`, ...row });
  emit();
  try {
    const saved = must(await supabase.from("console_dismissals").upsert(row, { onConflict: "kind,ref" }).select(COLS)) as unknown as ConsoleDismissal[];
    if (saved?.[0]) rows.set(k, saved[0]);
  } catch (e) {
    if (before) rows.set(k, before); else rows.delete(k);
    emit();
    throw e;
  }
}

/** Remove a dismissal (the item shows again). */
export async function restore(kind: DismissKind, ref: string): Promise<void> {
  if (!rows) rows = new Map();
  const k = dismissKey(kind, ref);
  const before = rows.get(k) ?? null;
  rows.delete(k);
  emit();
  try {
    must(await supabase.from("console_dismissals").delete().eq("kind", kind).eq("ref", ref));
  } catch (e) {
    if (before) rows.set(k, before);
    emit();
    throw e;
  }
}

/** Put a skipped email back to what it was (only while it is still skipped). */
async function unskip(id: string, status: "draft" | "approved"): Promise<void> {
  must(await supabase.from("outreach").update({ status }).eq("id", id).eq("status", "skipped").select("id"));
}

/**
 * X on an email or LinkedIn message. Draft or approved: skipped through outreach_decide first (so it is never sent),
 * then recorded. Anything else (sent, replied, waiting for Kuran): only recorded.
 */
export async function dismissOutreach(o: { id: string; status: string }, label: string | null): Promise<void> {
  if (skipsOnDismiss(o.status)) {
    await outreachDecide(o.id, "skip");
    try {
      await dismiss("outreach", o.id, label, skippedReason(o.status));
    } catch (e) {
      // Not recorded: put the email back as it was, so nothing is lost without a trace on the Dismissed page.
      await unskip(o.id, o.status as "draft" | "approved").catch(() => undefined);
      throw e;
    } finally {
      outreachChanged();
    }
    return;
  }
  await dismiss("outreach", o.id, label, null);
}

/** Bring back a dismissed item. For an email X skipped, its old status (draft or approved) comes back too. */
export async function restoreItem(kind: DismissKind, ref: string): Promise<void> {
  const prev = kind === "outreach" ? statusBeforeSkip(dismissalOf(kind, ref)?.reason) : null;
  if (prev) {
    await unskip(ref, prev);
    outreachChanged();
  }
  await restore(kind, ref);
}

/** Subscribe to changes in the dismissed set (returns the unsubscribe). */
export function onDismissalsChanged(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
