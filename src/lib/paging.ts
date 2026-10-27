// Server-side paging and search helpers: the console fetches one page at a time, never a whole table.
import { useEffect, useState } from "react";

/** Characters PostgREST treats as syntax inside or=(...): stripped from search words so a query can never break the filter. */
const UNSAFE = /[,()*%\\:"']/g;

/**
 * A PostgREST `or` filter that matches every word (each in any of the columns), e.g. "jo infra" over name,company →
 * "and(or(name.ilike.*jo*,company.ilike.*jo*),or(name.ilike.*infra*,company.ilike.*infra*))". Null when there is nothing to search.
 */
export function ilikeOr(q: string, cols: string[]): string | null {
  const words = q.replace(UNSAFE, " ").split(/\s+/).map((w) => w.trim()).filter((w) => w.length > 0).slice(0, 4);
  if (!words.length || !cols.length) return null;
  const one = (w: string) => cols.map((c) => `${c}.ilike.*${w}*`).join(",");
  if (words.length === 1) return one(words[0]);
  return `and(${words.map((w) => `or(${one(w)})`).join(",")})`;
}

/** The value, settled for `ms` (search boxes: one request after typing stops, not one per key). */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}
