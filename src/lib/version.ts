// Which build is running, and whether a newer one has been published. The check reads index.html from GitHub Pages
// (not Supabase) every five minutes and compares its nodus-build meta tag with the running build's SHA.
import { useEffect, useState } from "react";

export const BUILD_SHA: string = typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "dev";
export const BUILD_TIME: string = typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "";
export const VERSION_POLL_MS = 5 * 60 * 1000;

/** The SHA in a published index.html, or null when it has none. */
export function shaFromHtml(html: string): string | null {
  const m = html.match(/<meta\s+name=["']nodus-build["']\s+content=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

/** True only when both SHAs are known and differ (a dev build never nags). */
export function isNewer(running: string, published: string | null): boolean {
  return Boolean(published && running && running !== "dev" && published !== running);
}

const ukStamp = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function buildLabel(sha = BUILD_SHA, time = BUILD_TIME): string {
  const t = Date.parse(time);
  return `Build ${sha}${Number.isFinite(t) ? ` · ${ukStamp.format(new Date(t))} UK` : ""}`;
}

/** Polls index.html (no-store) and returns the newer SHA once one is published. */
export function useNewVersion(): string | null {
  const [newer, setNewer] = useState<string | null>(null);
  useEffect(() => {
    if (BUILD_SHA === "dev") return;
    let live = true;
    const check = async () => {
      try {
        const url = new URL("index.html", window.location.href.split("#")[0]);
        url.searchParams.set("v", String(Date.now()));
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) return;
        const sha = shaFromHtml(await res.text());
        if (live && isNewer(BUILD_SHA, sha)) setNewer(sha);
      } catch {
        /* offline: try again next time */
      }
    };
    const iv = window.setInterval(check, VERSION_POLL_MS);
    const first = window.setTimeout(check, 20_000);
    return () => { live = false; window.clearInterval(iv); window.clearTimeout(first); };
  }, []);
  return newer;
}
