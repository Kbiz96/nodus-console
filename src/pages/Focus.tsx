import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { useLoad } from "../lib/useLoad.ts";
import { prioritiesLoad } from "../lib/data.ts";
import { activeInOrder, greeting, replyPrompt, ukLongDate } from "../lib/focus.ts";
import { fmtDate, fmtNumber } from "../lib/format.ts";
import type { Outreach, Priority, PriorityProgress } from "../lib/types.ts";
import { OUTREACH_COLS } from "../components/TodayCrm.tsx";
import { AddPriority, AskClaude, PriorityCard } from "../components/PriorityCard.tsx";
import Deck from "../components/Deck.tsx";
import { Icon } from "../components/Brand.tsx";
import { ErrorBox, Loading, useTitle } from "../components/ui.tsx";

const SHOW_FIRST = 3;

export function usePriorities() {
  return useLoad(prioritiesLoad, "priorities");
}

/** The ADHD-friendly home: a few priorities, one draft at a time, and replies to answer. Nothing else. */
export default function Focus() {
  useTitle("Focus");
  const { data, error, loading, reload } = usePriorities();
  const priorities = data?.priorities ?? [];
  const now = new Date();
  return (
    <div className="focus">
      <header className="focus-head">
        <p className="focus-date">{ukLongDate(now)}</p>
        <h1>{greeting(now)}, Kuran.</h1>
        <p className="focus-lede">Here&rsquo;s what moves money today.</p>
      </header>

      <div className="focus-grid">
        <section className="focus-col" aria-labelledby="h-priorities">
          <div className="focus-sec">
            <h2 id="h-priorities">Your priorities</h2>
            <Link to="/priorities" className="small">All priorities</Link>
          </div>
          {error && !data ? (
            <ErrorBox error={error} onRetry={reload} />
          ) : loading && !data ? (
            <Loading what="Getting your priorities…" />
          ) : (
            <PriorityList priorities={priorities} progress={data?.progress ?? new Map()} onChanged={reload} />
          )}
        </section>

        <section className="focus-col focus-do" aria-labelledby="h-do">
          <div className="focus-sec">
            <h2 id="h-do">Do now</h2>
            <Link to="/review" className="small">Open full screen</Link>
          </div>
          <Deck priorities={priorities} onChanged={reload} />
          <Replies priorities={priorities} />
        </section>
      </div>
    </div>
  );
}

/** Active priorities in rank order: the top three as large cards, the rest one click away. */
export function PriorityList({ priorities, progress, onChanged, showAll = false }: {
  priorities: Priority[];
  progress: Map<string, PriorityProgress>;
  onChanged: () => void;
  showAll?: boolean;
}) {
  const [more, setMore] = useState(showAll);
  const active = activeInOrder(priorities);
  const shown = more ? active : active.slice(0, SHOW_FIRST);
  const hidden = active.length - shown.length;
  const nextRank = Math.max(0, ...priorities.map((p) => p.rank)) + 1;
  return (
    <div className="plist">
      {active.length === 0 && <p className="empty">No live priorities. Add the one thing you most want to close this week.</p>}
      {shown.map((p, i) => (
        <PriorityCard key={p.id} p={p} pr={progress.get(p.id)} above={active[i - 1] ?? null} below={active[i + 1] ?? null} onChanged={onChanged} />
      ))}
      {hidden > 0 && (
        <button type="button" className="padd" onClick={() => setMore(true)}>Show {hidden} more</button>
      )}
      {(more || active.length <= SHOW_FIRST) && <AddPriority nextRank={nextRank} onAdded={onChanged} />}
    </div>
  );
}

async function loadReplies() {
  return must(
    await supabase.from("outreach").select(OUTREACH_COLS).eq("status", "replied").order("replied_at", { ascending: false, nullsFirst: false }).limit(20),
  ) as unknown as Outreach[];
}

/** Replies received: collapsed by default, each with one button that gets Claude to draft the answer. */
function Replies({ priorities }: { priorities: Priority[] }) {
  const { data } = useLoad(loadReplies, "replies");
  const rows = data ?? [];
  const rank = new Map(priorities.map((p) => [p.id, p.rank]));
  return (
    <details className="waiting">
      <summary>
        <span>Waiting on others</span>
        <span className="muted small">{rows.length === 0 ? "No replies to answer" : `${fmtNumber(rows.length)} ${rows.length === 1 ? "reply" : "replies"} to answer`}</span>
      </summary>
      {rows.length === 0 ? (
        <p className="muted small waiting-empty">When someone replies, they show up here with a button to draft your answer.</p>
      ) : (
        <ul className="waiting-list">
          {rows.map((o) => {
            const day = o.replied_at ? fmtDate(o.replied_at) : undefined;
            return (
              <li key={o.id}>
                <div>
                  <strong>{o.to_name || "Unnamed"}</strong>
                  {o.company && <span className="muted"> at {o.company}</span>}
                  <p className="small muted">{o.subject || "LinkedIn"}{day ? `, replied ${day}` : ""}</p>
                </div>
                <AskClaude className="btn" prompt={replyPrompt(o, o.priority_id ? rank.get(o.priority_id) ?? null : null, day)}>
                  <Icon.claude />Draft reply with Claude
                </AskClaude>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
