import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { briefLoad, liveCountsLoad } from "../lib/data.ts";
import { useLoad } from "../lib/useLoad.ts";
import { ukToday } from "../lib/crm.ts";
import { greeting, ukLongDate } from "../lib/focus.ts";
import { remember } from "../lib/calm.ts";
import { briefItems, briefMissingNote, couldDo, liveItems, mergeDoNow, type Brief, type DoItem } from "../lib/brief.ts";
import { AskClaude } from "./PriorityCard.tsx";
import { Icon } from "./Brand.tsx";

/** Events that change the live counts: a draft decided, a lead approved or dismissed. */
export const LIVE_EVENTS = ["nodus-outreach-changed", "nodus-leads-changed"] as const;

/** Scroll to a block on the front page, opening it first if it is a folded <details>. */
export function jumpTo(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  if (el instanceof HTMLDetailsElement) el.open = true;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  const focusable = el.querySelector<HTMLElement>("summary, h2, [tabindex]");
  focusable?.focus({ preventScroll: true });
}

function useDone(day: string): [Set<string>, (key: string) => void] {
  const key = `nodus-done-${day}`;
  const [done, setDone] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(remember(key) ?? "[]") as string[]); } catch { return new Set(); }
  });
  const toggle = (k: string) => {
    const next = new Set(done);
    if (next.has(k)) next.delete(k); else next.add(k);
    remember(key, JSON.stringify([...next]));
    setDone(next);
  };
  return [done, toggle];
}

/**
 * The top of the front page: today's brief (headline, calls, Do now, Could do, a 2-minute rep, a short digest),
 * with live items (replies, drafts, new leads) merged into Do now so it is right even before the brief lands.
 */
export function TodayBrief() {
  const now = new Date();
  const day = ukToday(now);
  const briefQ = useLoad(() => briefLoad(day), `brief-${day}`);
  const liveQ = useLoad(liveCountsLoad, "live-counts");
  const reloadLive = liveQ.reload;
  useEffect(() => {
    for (const e of LIVE_EVENTS) window.addEventListener(e, reloadLive);
    return () => { for (const e of LIVE_EVENTS) window.removeEventListener(e, reloadLive); };
  }, [reloadLive]);
  const [done, toggleDone] = useDone(day);

  const brief: Brief | null = briefQ.data ?? null;
  const live = liveQ.data ? liveItems(liveQ.data) : [];
  const { now: doNow, overflow } = mergeDoNow(briefItems(brief?.do_now ?? []), live);
  const could = couldDo(overflow, brief?.could_do ?? []);
  const waiting = briefQ.loading && !briefQ.data;
  const hasAside = Boolean(brief);

  return (
    <section className="today" aria-labelledby="h-today">
      <header className="focus-head today-head">
        <div className="today-dateline">
          <span className="focus-date">{ukLongDate(now)}</span>
          <h1 id="h-today">{greeting(now)}, Kuran.</h1>
        </div>
        {brief?.headline ? (
          <p className="today-headline">{brief.headline}</p>
        ) : waiting ? (
          <p className="today-headline is-quiet" aria-busy="true">Getting today’s brief…</p>
        ) : (
          <p className="today-headline is-quiet">{brief ? "Here’s what moves money today." : briefMissingNote(now)}</p>
        )}
      </header>

      <div className={`today-grid${hasAside ? "" : " is-single"}`}>
        <div className="today-main">
          <div className="today-sec">
            <h2 id="h-do">Do now</h2>
            {doNow.length > 0 && <span className="muted small">{doNow.length === 1 ? "One thing" : `${doNow.length} things, in order`}</span>}
          </div>
          {doNow.length === 0 ? (
            <p className="donow-empty">{liveQ.loading && !liveQ.data ? "Checking what’s waiting…" : "Nothing urgent. Pick a mandate below and move it one step."}</p>
          ) : (
            <ol className="donow" aria-labelledby="h-do">
              {doNow.map((d, i) => (
                <DoRow key={d.key} d={d} n={i + 1} first={i === 0} done={done.has(d.key)} onDone={d.live ? undefined : () => toggleDone(d.key)} />
              ))}
            </ol>
          )}
          {could.length > 0 && (
            <details className="could">
              <summary>
                <span>Could do</span>
                <span className="muted small">{could.length} {could.length === 1 ? "idea" : "ideas"}, when Do now is clear</span>
              </summary>
              <ul>
                {could.map((c) => (
                  <li key={c.key}>
                    <span>{c.text}</span>
                    {c.item && <DoAct d={c.item} className="net-link" />}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        {hasAside && brief && (
          <aside className="today-aside" aria-label="Today’s brief">
            <div className="calls">
              <h3>Calls today</h3>
              {brief.calls.length === 0 ? (
                <p className="muted small">No calls today.</p>
              ) : (
                <ol>
                  {brief.calls.map((c, i) => (
                    <li key={`${c.time}-${i}`}>
                      <time>{c.time || "—"}</time>
                      <span className="call-who">{c.who}</span>
                      {c.goal && <span className="call-goal">{c.goal}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
            {brief.rep && <Rep q={brief.rep.q} a={brief.rep.a} />}
            {brief.digest.length > 0 && (
              <div className="digest">
                <h3>Digest</h3>
                <ul>{brief.digest.map((d, i) => <li key={i}>{d}</li>)}</ul>
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}

function DoAct({ d, className }: { d: DoItem; className: string }) {
  const a = d.action;
  if (a.kind === "route") return <Link className={className} to={a.to}>{d.cta}</Link>;
  if (a.kind === "href") return <a className={className} href={a.href} target="_blank" rel="noopener noreferrer">{d.cta}<Icon.external /></a>;
  if (a.kind === "scroll") return <button type="button" className={className} onClick={() => jumpTo(a.target)}>{d.cta}</button>;
  return <AskClaude className={className} prompt={a.prompt}><Icon.claude />{d.cta}</AskClaude>;
}

function DoRow({ d, n, first, done, onDone }: { d: DoItem; n: number; first: boolean; done: boolean; onDone?: () => void }) {
  return (
    <li className={`do-row${done ? " is-done" : ""}${d.live ? " is-live" : ""}`}>
      <span className="do-n" aria-hidden>{n}</span>
      <div className="do-what">
        <p className="do-text">{d.text}</p>
        {d.detail && <p className="do-detail">{d.detail}</p>}
      </div>
      <div className="do-acts">
        {!done && <DoAct d={d} className={`btn${first ? " primary" : ""} do-go`} />}
        {onDone && (
          <button type="button" className="do-done" aria-pressed={done} onClick={onDone} aria-label={done ? `Not done: ${d.text}` : `Done: ${d.text}`} title={done ? "Mark not done" : "Mark done"}>
            <Icon.check />
          </button>
        )}
      </div>
    </li>
  );
}

function Rep({ q, a }: { q: string; a: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="rep">
      <h3>2-minute rep</h3>
      <p className="rep-q">{q}</p>
      {shown ? (
        <p className="rep-a">{a || "No answer in today’s brief."}</p>
      ) : (
        <button type="button" className="net-link" onClick={() => setShown(true)}>Show answer</button>
      )}
    </div>
  );
}
