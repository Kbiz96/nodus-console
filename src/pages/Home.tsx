import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { briefLoad, liveCountsLoad } from "../lib/data.ts";
import { useLoad } from "../lib/useLoad.ts";
import { useCached } from "../lib/cache.ts";
import { ukToday } from "../lib/crm.ts";
import { greeting, ukLongDate } from "../lib/focus.ts";
import { remember } from "../lib/calm.ts";
import { withoutParked } from "../lib/mandates.ts";
import { fmtDate, fmtNumber } from "../lib/format.ts";
import { briefItems, briefMissingNote, couldDo, focusSession, liveItems, sessionPrompt, type Brief, type DoItem } from "../lib/brief.ts";
import { repliesOwed, sendState, sendStatusText, type OwedRow } from "../lib/today.ts";
import type { Deal, Outreach } from "../lib/types.ts";
import { OUTREACH_COLS } from "../components/TodayCrm.tsx";
import { AskClaude } from "../components/PriorityCard.tsx";
import Deck from "../components/Deck.tsx";
import { OlderApproved, SentLane } from "../components/SentLane.tsx";
import { LinkedInPanel } from "../components/LinkedInPanel.tsx";
import { Questions } from "../components/Questions.tsx";
import { MandateRows } from "../components/MandateRows.tsx";
import { HandoffContext } from "../components/handoff.ts";
import { Icon } from "../components/Brand.tsx";
import { ErrorBox, Loading, useTitle } from "../components/ui.tsx";
import { usePriorities } from "./Leads.tsx";

const TABS = ["send", "linkedin", "replies", "questions", "plan"] as const;
type Tab = (typeof TABS)[number];
const TAB_KEY = "nodus-home-tab";

/** Events that change the live counts: a draft decided, a lead approved or dismissed. */
const LIVE_EVENTS = ["nodus-outreach-changed", "nodus-leads-changed"] as const;

/** Focus items point at a block (approve, replies…). Those now live in tabs: open the right tab, then scroll to it. */
const TAB_FOR: Record<string, Tab> = { approve: "send", linkedin: "linkedin", replies: "replies", questions: "questions", focus: "plan" };
function jumpTo(id: string): void {
  const tab = TAB_FOR[id];
  if (tab) window.dispatchEvent(new CustomEvent<Tab>("nodus-home-tab", { detail: tab }));
  window.setTimeout(() => {
    const el = document.getElementById(tab ? "work" : id);
    if (!el) return;
    if (el instanceof HTMLDetailsElement) el.open = true;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, 0);
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
 * Today: the front page. Three blocks, no side rail (10 Nov 2026 rework): the headline and sending line; "On the desk",
 * the live deals (heat = Hot) as cards; and one tabbed work panel (Send email, LinkedIn, Replies owed, Questions,
 * Today's plan) so only one list is on screen at a time. Priorities and lead lanes sit folded at the bottom.
 */
export default function Home() {
  useTitle("Today");
  const now = new Date();
  const day = ukToday(now);
  const briefQ = useCached(() => briefLoad(day), `brief:${day}`);
  const liveQ = useLoad(liveCountsLoad, "live-counts");
  const repliedQ = useLoad(loadReplied, "replied");
  const prioQ = usePriorities();
  const reloadLive = liveQ.reload;
  useEffect(() => {
    for (const e of LIVE_EVENTS) window.addEventListener(e, reloadLive);
    return () => { for (const e of LIVE_EVENTS) window.removeEventListener(e, reloadLive); };
  }, [reloadLive]);
  const [done, toggleDone] = useDone(day);

  const deskQ = useLoad(loadDesk, "desk");
  const [tab, setTabState] = useState<Tab>(() => {
    const t = remember(TAB_KEY);
    return (TABS as readonly string[]).includes(t ?? "") ? (t as Tab) : "send";
  });
  const setTab = (t: Tab) => { remember(TAB_KEY, t); setTabState(t); };
  useEffect(() => {
    const on = (e: Event) => { const t = (e as CustomEvent<Tab>).detail; if (t) { remember(TAB_KEY, t); setTabState(t); } };
    window.addEventListener("nodus-home-tab", on);
    return () => window.removeEventListener("nodus-home-tab", on);
  }, []);

  const brief: Brief | null = briefQ.data ?? null;
  // Sending is a press of Send (from Gmail); the line also says when the last email went out, when known.
  const sendEnabled = sendState(liveQ.data?.lastSentAt ?? null);
  const owed = repliesOwed(brief?.replies ?? [], repliedQ.data ?? []);
  const live = liveQ.data ? liveItems({ ...liveQ.data, replies: owed.length }, sendEnabled) : [];
  const { now: session, overflow } = focusSession(briefItems(brief?.do_now ?? [], liveQ.data ?? null), live);
  const could = couldDo(overflow, brief?.could_do ?? []);
  const forClaude = session.filter((d) => d.action.kind === "claude" && !done.has(d.key));
  const waiting = briefQ.loading && !briefQ.data;
  const priorities = prioQ.data?.priorities ?? [];

  const drafts = liveQ.data?.drafts ?? null;
  const tabs: { id: Tab; label: string; count: number | null }[] = [
    { id: "send", label: "Send email", count: drafts },
    { id: "linkedin", label: "LinkedIn", count: null },
    { id: "replies", label: "Replies owed", count: owed.length || null },
    { id: "questions", label: "Questions", count: null },
    { id: "plan", label: "Today’s plan", count: session.length || null },
  ];

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
        <p className="sendline is-on" role="status">
          <span className="sendline-dot" aria-hidden />
          {sendStatusText(sendEnabled)}
        </p>
      </header>

      <section className="desk" aria-labelledby="h-desk">
        <div className="today-sec">
          <h2 id="h-desk">On the desk</h2>
          <Link to="/deals" className="small muted">All deals</Link>
        </div>
        <Desk q={deskQ} today={day} />
      </section>

      <section className="work" id="work" aria-label="Work">
        <div className="work-tabs" role="tablist" aria-label="What to work on">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`}
              className={`work-tab${tab === t.id ? " is-on" : ""}`} onClick={() => setTab(t.id)}>
              {t.label}{t.count != null && t.count > 0 && <span className="work-n">{fmtNumber(t.count)}</span>}
            </button>
          ))}
        </div>
        <div className="work-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "send" && (
            <div id="approve">
              <p className="muted small work-hint">Emails one at a time. Approve, edit or skip; Send goes from Gmail.</p>
              <Deck priorities={priorities} onChanged={prioQ.reload} emailOnly sendEnabled={sendEnabled} />
              <OlderApproved />
              <SentLane />
            </div>
          )}
          {tab === "linkedin" && (
            <div id="linkedin">
              <p className="muted small work-hint">You send these yourself. The agent button drafts more.</p>
              <LinkedInPanel />
            </div>
          )}
          {tab === "replies" && (
            <div id="replies">
              <Replies rows={owed} loading={(briefQ.loading && !briefQ.data) || (repliedQ.loading && !repliedQ.data)} />
            </div>
          )}
          {tab === "questions" && (
            <div id="questions">
              <p className="muted small work-hint">Answer here; it goes on the record.</p>
              <Questions />
            </div>
          )}
          {tab === "plan" && (
            <div id="focus" className="plan">
              {session.length === 0 ? (
                <p className="donow-empty">{liveQ.loading && !liveQ.data ? "Checking what’s waiting…" : "Nothing urgent. Move one desk deal a step."}</p>
              ) : (
                <ol className="donow" aria-label="Today’s plan">
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
                </div>
              )}
              {could.length > 0 && (
                <details className="could">
                  <summary><span>Could do</span><span className="muted small">{could.length} {could.length === 1 ? "idea" : "ideas"}</span></summary>
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
              {brief && brief.calls.length > 0 && (
                <div className="calls">
                  <h3>Calls today</h3>
                  <ol>
                    {brief.calls.map((c, i) => (
                      <li key={`${c.time}-${i}`}>
                        <time>{c.time || "—"}</time>
                        <span className="call-who">{c.who}</span>
                        {c.goal && <span className="call-goal">{c.goal}</span>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {brief && (brief.digest.length > 0 || brief.rep) && (
                <details className="brief-more">
                  <summary>More from the brief</summary>
                  {brief.digest.length > 0 && <ul className="digest-list">{brief.digest.map((d, i) => <li key={i}>{d}</li>)}</ul>}
                  {brief.rep && <Rep q={brief.rep.q} a={brief.rep.a} />}
                </details>
              )}
            </div>
          )}
        </div>
      </section>

      <details className="home-mandates" id="signed-mandates">
        <summary>
          <span>Priorities and lead lanes</span>
          <span className="muted small">{priorities.length} active · <Link to="/priorities">edit</Link></span>
        </summary>
        {prioQ.error && !prioQ.data ? (
          <ErrorBox error={prioQ.error} onRetry={prioQ.reload} />
        ) : prioQ.loading && !prioQ.data ? (
          <Loading what="Getting your priorities…" />
        ) : (
          <MandateRows priorities={priorities} progress={prioQ.data?.progress ?? new Map()} onChanged={prioQ.reload} />
        )}
      </details>
    </div>
    </HandoffContext.Provider>
  );
}

type DeskDeal = Pick<Deal, "id" | "deal" | "counterparty" | "line" | "stage" | "ncnda_signed" | "fee_signed" | "next_step" | "next_date">;

/** The desk: deals marked Hot, soonest next step first. Set a deal to Hot on the Deals page to put it here. */
async function loadDesk(): Promise<DeskDeal[]> {
  return must(
    await supabase.from("deals").select("id,deal,counterparty,line,stage,ncnda_signed,fee_signed,next_step,next_date")
      .eq("heat", "Hot").order("next_date", { ascending: true, nullsFirst: false }).limit(8),
  ) as unknown as DeskDeal[];
}

function deskName(d: DeskDeal): string {
  const n = (d.deal ?? d.counterparty ?? "Deal").split(":")[0].trim();
  return n.length > 40 ? `${n.slice(0, 38)}…` : n;
}

function deskWhat(d: DeskDeal): string | null {
  const i = (d.deal ?? "").indexOf(":");
  return i > 0 ? d.deal!.slice(i + 1).trim() : null;
}

function Desk({ q, today }: { q: { data: DeskDeal[] | null; error: unknown; loading: boolean; reload: () => void }; today: string }) {
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (q.loading && !q.data) return <Loading what="Getting the desk…" />;
  const rows = q.data ?? [];
  if (rows.length === 0) return <p className="donow-empty">Nothing on the desk. Mark a deal Hot on the Deals page to pin it here.</p>;
  return (
    <ul className="desk-grid">
      {rows.map((d) => {
        const due = d.next_date ?? null;
        const late = due != null && due < today;
        const isToday = due === today;
        return (
          <li key={d.id} className={`desk-card${late ? " is-late" : ""}`}>
            <Link to={`/deals?id=${d.id}`} className="desk-link">
              <div className="desk-top">
                <span className="desk-name">{deskName(d)}</span>
                {d.stage && <span className="desk-stage">{d.stage}</span>}
              </div>
              {deskWhat(d) && <p className="desk-what">{deskWhat(d)}</p>}
              <p className="desk-next">{d.next_step ?? "No next step set."}</p>
              <div className="desk-foot">
                <span className={`desk-due${late ? " is-late" : isToday ? " is-today" : ""}`}>
                  {due == null ? "No date" : late ? `Overdue · ${fmtDate(due)}` : isToday ? "Today" : fmtDate(due)}
                </span>
                <span className="desk-gates">
                  <span className={d.ncnda_signed === "Yes" ? "ok" : "muted"}>NCNDA</span>
                  <span className={d.fee_signed === "Yes" ? "ok" : "muted"}>Fee</span>
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
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
