// Calm mode: hides the status-strip counters and the count-up and glow effects. Remembered per browser.

const KEY = "nodus-calm";

export function calmPref(): "on" | "off" | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "on" || v === "off" ? v : null;
  } catch {
    return null;
  }
}

export function setCalmPref(v: "on" | "off"): void {
  try {
    window.localStorage.setItem(KEY, v);
  } catch {
    /* private window or blocked storage: it still works for this visit */
  }
}

/** True while calm mode is on (set on <html data-calm="on"> by the layout). */
export function isCalm(): boolean {
  try {
    return document.documentElement.dataset.calm === "on";
  } catch {
    return false;
  }
}

/** Small per-browser memory for things like a collapsed menu. Never throws. */
export function remember(key: string, value?: string): string | null {
  try {
    if (value !== undefined) window.localStorage.setItem(key, value);
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
