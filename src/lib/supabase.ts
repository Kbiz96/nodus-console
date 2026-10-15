import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../config.ts";

// The session is kept in this browser's local storage by supabase-js and refreshed automatically.
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "nodus-console-auth" },
});

export class DbError extends Error {
  code?: string;
  constructor(e: { message: string; code?: string }) {
    super(e.message);
    this.code = e.code;
  }
}

/** Unwrap a supabase-js result: return the data or throw the database's own message. */
export function must<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new DbError(res.error);
  return res.data as T;
}

/** Unwrap a counted result. */
export function mustCount<T>(res: { data: T | null; count: number | null; error: { message: string; code?: string } | null }): {
  rows: T;
  count: number;
} {
  if (res.error) throw new DbError(res.error);
  return { rows: (res.data ?? []) as T, count: res.count ?? 0 };
}
