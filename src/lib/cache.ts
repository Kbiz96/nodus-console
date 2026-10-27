// Read-mostly data (mandates, priorities, the brief, the board) is cached per session in memory and in this browser's
// localStorage for ten minutes, so moving between pages does not refetch it. A reload after a write always fetches fresh.
// Storage can be blocked (private window): then only the in-memory copy is used.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Loaded } from "./useLoad.ts";

export const CACHE_TTL_MS = 10 * 60 * 1000;
const PREFIX = "nodus-cache:";
const VERSION = 1;

interface Entry { at: number; v: number; data: unknown }
const mem = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

function readStore(key: string): Entry | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const e = JSON.parse(raw) as Entry;
    return e && e.v === VERSION && typeof e.at === "number" ? e : null;
  } catch {
    return null;
  }
}

function writeStore(key: string, e: Entry): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(e));
  } catch {
    /* full or blocked: memory still holds it */
  }
}

/** The cached entry for a key (memory first, then storage), fresh or not. */
export function peek<T>(key: string): { data: T; at: number } | null {
  const m = mem.get(key) ?? readStore(key);
  if (!m) return null;
  mem.set(key, m);
  return { data: m.data as T, at: m.at };
}

export function isFresh(at: number, now = Date.now(), ttl = CACHE_TTL_MS): boolean {
  return now - at < ttl;
}

/** Fetch through the cache: a fresh copy is returned without a request unless `force`. Concurrent calls share one request. */
export async function cached<T>(key: string, fn: () => Promise<T>, opts: { force?: boolean; ttl?: number } = {}): Promise<T> {
  const hit = peek<T>(key);
  if (hit && !opts.force && isFresh(hit.at, Date.now(), opts.ttl)) return hit.data;
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = fn().then((data) => {
    const e: Entry = { at: Date.now(), v: VERSION, data };
    mem.set(key, e);
    writeStore(key, e);
    return data;
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Drop cached keys that start with `prefix` (after a write elsewhere changed them). */
export function invalidate(prefix: string): void {
  for (const k of [...mem.keys()]) if (k.startsWith(prefix)) mem.delete(k);
  try {
    const ls = window.localStorage;
    for (let i = ls.length - 1; i >= 0; i--) {
      const k = ls.key(i);
      if (k && k.startsWith(PREFIX + prefix)) ls.removeItem(k);
    }
  } catch {
    /* blocked storage */
  }
}

/**
 * Like useLoad, through the cache: shows the cached copy at once, fetches only when it is missing or older than ten
 * minutes, and when the window regains focus only if stale. `reload()` always fetches fresh (use it after a write).
 */
export function useCached<T>(fn: () => Promise<T>, key: string, ttl = CACHE_TTL_MS): Loaded<T> {
  const first = peek<T>(key);
  const [data, setData] = useState<T | null>(first ? first.data : null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(!first);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const keyRef = useRef(key);
  keyRef.current = key;

  const run = useCallback((force: boolean) => {
    const k = keyRef.current;
    const hit = peek<T>(k);
    if (hit) setData(hit.data);
    if (hit && !force && isFresh(hit.at, Date.now(), ttl)) { setLoading(false); return () => undefined; }
    let live = true;
    setLoading(true);
    setError(null);
    cached(k, () => fnRef.current(), { force: true, ttl }).then(
      (d) => { if (live && keyRef.current === k) { setData(d); setLoading(false); } },
      (e) => { if (live && keyRef.current === k) { setError(e); setLoading(false); } },
    );
    return () => { live = false; };
  }, [ttl]);

  useEffect(() => run(false), [key, run]);
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      const hit = peek<T>(keyRef.current);
      if (!hit || !isFresh(hit.at, Date.now(), ttl)) run(false);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [run, ttl]);

  const reload = useCallback(() => { run(true); }, [run]);
  return { data, error, loading, reload };
}
