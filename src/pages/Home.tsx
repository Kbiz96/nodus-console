import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { briefLoad, liveCountsLoad } from "../lib/data.ts";
import { useLoad } from "../lib/useLoad.ts";
import { ukToday } from "../lib/crm.ts";
import { greeting, ukLongDate } from "../lib/focus.ts";
import { remember } from "../lib/calm.ts";
import { withoutParked } from "../lib/mandates.ts";
import { fmtNumber } from "../lib/format.ts";
import { briefItems, briefMissingNote, couldDo, focusSession, liveItems, sessionPrompt, type Brief, type DoItem } from "../lib/brief.ts";
import { isSendOn, repliesOwed, sendStatusText, type OwedRow } from "../lib/today.ts";
import type { Outreach } from "../lib/types.ts";
import { OUTREACH_COLS } from "../components/TodayCrm.tsx";
import { AskClaude } from "../components/PriorityCard.tsx";
import Deck from "../components/Deck.tsx";
import { LinkedInPanel } from "../components/LinkedInPanel.tsx";
import { MandateRows } from "../components/MandateRows.tsx";
import { HandoffContext } from "../components/handoff.ts";
import { Icon } from "../components/Brand.tsx";
import { ErrorBox, Loading, useTitle } from "../components/ui.tsx";
import { usePriorities } from "./Leads.tsx";

/** Events that change the live counts: a draft decided, a lead approved or dismissed. */
const LIVE_EVENTS = ["nodus-outreach-changed", "nodus-leads-changed"] as const;

/** Scroll to a block on the page, opening it first if it is a folded <details>. */
function jumpTo(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  if (el instanceof HTMLDetailsElement) el.open = true;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  el.querySelector<HTMLElement>("summary, h2, [tabindex]")?.focus({ preventScroll: true });
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

async function loadReplied(): Promise<Outreach[]> {
  return withoutParked(must(
    await supabase.from("outreach").select(OUTREACH_COLS).eq("status", "replied").order("replied_at", { ascending: false, nullsFirst: false }).limit(20),
  ) as unknown as Outreach[]);
}

/**
 * Today: the front page and the only screen Kuran needs most days. Top to bottom: the brief's headline and the
 * honest sending line, the focus session (three things at most), replies owed (answers already drafted in Gmail),
 * one email at a time to approve, LinkedIn he can send now, and the signed mandates as one-line rows.
 * There is one Claude hand-off on this screen: the focus session's items that have no link of their own.
 */
export default function Home() {
  useTitle("Today");
  const now = new Date();
  const day = ukToday(now);
  const briefQ = useLoad(() => briefLoad(day), `brief-${day}`);
  const liveQ = useLoad(liveCountsLoad, "live-counts");
  const repliedQ = useLoad(loadReplied, "replied");
  const prioQ = usePriorities();
  const reloadLive = liveQ.reload;
  useEffect(() => {
    for (const e of LIVE_EVENTS) window.addEventListener(e, reloadLive);
    return () => { for (const e of LIVE_EVENTS) window.removeEventListener(e, reloadLive); };
  }, [reloadLive]);
  const [done, toggleDone] = useDone(day);

  const brief: Brief | null = briefQ.data ?? null;
  const sendEnabled = brief?.send_enabled ?? null;
  const owed = repliesOwed(brief?.replies ?? [], repliedQ.data ?? []);
  const live = liveQ.data ? liveItems({ ...liveQ.data, replies: owed.length }, sendEnabled) : [];
  const { now: session, overflow } = focusSession(briefItems(brief?.do_now ?? []), live);
  const could = couldDo(overflow, brief?.could_do ?? []);
  const forClaude = session.filter((d) => d.action.kind === "claude" && !done.has(d.key));
  const waiting = briefQ.loading && !briefQ.data;
  const priorities = prioQ.data?.priorities ?? [];

  return (
    <HandoffContext.Provider value={false}>
    <div className="home">
      <header className="home-head">
        <p className="home-dateline"><span>{ukLongDate(now)}</span> {greeting(now)}, Kuran.</p>
        {brief?.headline ? (
          <h1 className="home-headline">{brief.headline}</h1>
        ) : (
          <h1 className="home-headline is-quiet" aria-busy={waiting || undefined}>{waiting ? "Getting today’s brief…" : brief ? "Here’s what moves money today." : briefMissingNote(now)}</h1>
        )}
        <p className={`sendline ${isSendOn(sendEnabled) ? "is-on" : "is-off"}`} role="status">
          <span className="sendline-dot" aria-hidden />
          {waiting ? "Checking whether sending is on…" : sendStatusText(sendEnabled)}
        </p>
      </header>

      <div className="home-grid">
        <section className="home-focus" id="focus" aria-labelledby="h-focus">
          <div className="today-sec">
            <h2 id="h-focus">Focus session</h2>
            {session.length > 0 && <span className="muted small">{session.length === 1 ? "One thing" : `${session.length} things, in order`}</span>}
          </div>
          {session.length === 0 ? (
            <p className="donow-empty">{liveQ.loading && !liveQ.data ? "Checking what’s waiting…" : "Nothing urgent. Open a mandate below and move it one step."}</p>
          ) : (
            <ol className="donow" aria-labelledby="h-focus">
              {session.map((d, i) => (
                <DoRow key={d.key} d={d} n={i + 1} first={i === 0} done={done.has(d.key)} onDone={d.live ? undefined : () => toggleDone(d.key)} />
              ))}
            </ol>
          )}
          {forClaude.length > 0 && (
            <div className="session-claude">
              <AskClaude className="btn" prompt={sessionPrompt(forClaude)}>
                <Icon.claude />{forClaude.length === 1 ? "Hand the unlinked item to Claude" : `Hand these ${forClaude.length} to Claude`}
              </AskClaude>
              <span className="muted small">One chat for the items with no link. Drafts land in Gmail or here; nothing is sent.</span>
            </div>
          )}
          {could.length > 0 && (
            <details className="could">
              <summary>
                <span>Could do</span>
                <span className="muted small">{could.length} {could.length === 1 ? "idea" : "ideas"}, when the session is clear</span>
              </summary>
              <ul>
                {could.map((c) => (
                  <li key={c.key}>
                    <span>{c.text}</span>
                    {c.item && c.item.action.kind !== "claude" && <DoAct d={c.item} className="net-link" />}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <div className="home-side">
          <section className="home-replies" id="replies" aria-labelledby="h-replies">
            <div className="today-sec">
              <h2 id="h-replies" tabIndex={-1}>Replies owed</h2>
              {owed.length > 0 && <span className="muted small">{fmtNumber(owed.length)} {owed.length === 1 ? "person is" : "people are"} waiting</span>}
            </div>
            <Replies rows={owed} loading={(briefQ.loading && !briefQ.data) || (repliedQ.loading && !repliedQ.data)} />
          </section>

          {brief && (brief.calls.length > 0 || brief.digest.length > 0 || brief.rep) && (
            <aside className="today-aside home-calls" aria-label="Today’s brief">
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
              {(brief.digest.length > 0 || brief.rep) && (
                <details className="brief-more">
                  <summary>More from the brief</summary>
                  {brief.digest.length > 0 && <ul className="digest-list">{brief.digest.map((d, i) => <li key={i}>{d}</li>)}</ul>}
                  {brief.rep && <Rep q={brief.rep.q} a={brief.rep.a} />}
                </details>
              )}
            </aside>
          )}

          <section className="home-li" id="linkedin" aria-labelledby="h-li">
            <div className="today-sec">
              <h2 id="h-li">LinkedIn</h2>
              <span className="muted small">You send these yourself</span>
            </div>
            <LinkedInPanel />
          </section>
        </div>

        <section className="home-approve" id="approve" aria-labelledby="h-approve">
          <div className="today-sec">
            <h2 id="h-approve" tabIndex={-1}>Approve</h2>
            <span className="muted small">Emails, one at a time</span>
          </div>
          <Deck priorities={priorities} onChanged={prioQ.reload} emailOnly sendEnabled={sendEnabled} />
        </section>
      </div>

      <section className="home-mandates" id="signed-mandates" aria-labelledby="h-mandates">
        <div className="today-sec">
          <h2 id="h-mandates" tabIndex={-1}>Signed mandates</h2>
          <Link to="/priorities" className="small muted">Edit priorities</Link>
        </div>
        {prioQ.error && !prioQ.data ? (
          <ErrorBox error={prioQ.error} onRetry={prioQ.reload} />
        ) : prioQ.loading && !prioQ.data ? (
          <Loading what="Getting your mandates…" />
        ) : (
          <MandateRows priorities={priorities} progress={prioQ.data?.progress ?? new Map()} onChanged={prioQ.reload} />
        )}
      </section>
    </div>
    </HandoffContext.Provider>
  );
}

function Replies({ rows, loading }: { rows: OwedRow[]; loading: boolean }) {
  if (loading) return <p className="muted small">Checking replies…</p>;
  if (rows.length === 0) return <p className="replies-empty">No replies owed. Checked 06:40 and 17:45.</p>;
  return (
    <ul className="owed">
      {rows.map((r) => (
        <li key={r.key} className="owed-row">
          <div className="owed-what">
            <p className="owed-who"><strong>{r.who}</strong>{r.company && <span className="muted"> at {r.company}</span>}</p>
            {r.summary && <p className="owed-sum">{r.summary}</p>}
          </div>
          <a className={`btn${r.ready ? " primary" : ""} owed-go`} href={r.url} target="_blank" rel="noopener noreferrer">
            {r.ready ? "Open draft in Gmail" : "Find in Gmail"}<Icon.external />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** A focus item's one button. Items with no link have none here: the session's single Claude button covers them. */
function DoAct({ d, className }: { d: DoItem; className: string }) {
  const a = d.action;
  if (a.kind === "route") return <Link className={className} to={a.to}>{d.cta}</Link>;
  if (a.kind === "href") return <a className={className} href={a.href} target="_blank" rel="noopener noreferrer">{d.cta}<Icon.external /></a>;
  if (a.kind === "scroll") return <button type="button" className={className} onClick={() => jumpTo(a.target)}>{d.cta}</button>;
  return null;
}

function DoRow({ d, n, first, done, onDone }: { d: DoItem; n: number; first: boolean; done: boolean; onDone?: () => void }) {
  const viaClaude = d.action.kind === "claude";
  return (
    <li className={`do-row${done ? " is-done" : ""}${d.live ? " is-live" : ""}`}>
      <span className="do-n" aria-hidden>{n}</span>
      <div className="do-what">
        <p className="do-text">{d.text}</p>
        {(d.detail || viaClaude) && <p className="do-detail">{d.detail ?? "No link: tick it off, or hand it to Claude below."}</p>}
      </div>
      <div className="do-acts">
        {!done && !viaClaude && <DoAct d={d} className={`btn${first ? " primary" : ""} do-go`} />}
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
      {shown ? <p className="rep-a">{a || "No answer in today’s brief."}</p> : <button type="button" className="net-link" onClick={() => setShown(true)}>Show answer</button>}
    </div>
  );
}
