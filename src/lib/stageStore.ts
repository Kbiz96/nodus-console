// Local, optimistic state for the sequencer, shared by every view: opportunities just handed to Claude
// ("With Claude") and stages changed in this browser before the database view catches up.
import { useSyncExternalStore } from "react";
import type { SeqAction, Stage } from "./sequencer.ts";

const KEY = "nodus-with-claude";
const KEEP_MS = 12 * 3600e3;

interface WithClaude { action: SeqAction; at: number }
interface State { withClaude: Map<string, WithClaude>; stage: Map<string, Stage> }

function read(): Map<string, WithClaude> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, WithClaude>;
    const now = Date.now();
    return new Map(Object.entries(raw).filter(([, v]) => v && now - v.at < KEEP_MS));
  } catch {
    return new Map();
  }
}
function write(m: Map<string, WithClaude>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(m)));
  } catch {
    /* private window: it still works for this visit */
  }
}

let state: State = { withClaude: typeof window === "undefined" ? new Map() : read(), stage: new Map() };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function markWithClaude(ids: string[], action: SeqAction): void {
  const m = new Map(state.withClaude);
  const at = Date.now();
  for (const id of ids) m.set(id, { action, at });
  write(m);
  state = { ...state, withClaude: m };
  emit();
}

export function setLocalStage(entries: [string, Stage | null][]): void {
  const m = new Map(state.stage);
  for (const [id, s] of entries) {
    if (s) m.set(id, s);
    else m.delete(id);
  }
  state = { ...state, stage: m };
  emit();
}

function subscribe(f: () => void) {
  subs.add(f);
  return () => subs.delete(f);
}

export function useSeqState(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** The stage to show: a change made here wins over the loaded one until the page reloads it. */
export function shownStage(s: State, id: string, loaded: Stage | undefined): Stage {
  return s.stage.get(id) ?? loaded ?? "found";
}
