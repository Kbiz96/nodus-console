import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { useLoad } from "../lib/useLoad.ts";
import { prioritiesLoad, priorityDeals } from "../lib/data.ts";
import { activeInOrder, replyPrompt } from "../lib/focus.ts";
import { groupPriorities, splitVisible, withoutParked } from "../lib/mandates.ts";
import { fmtDate, fmtNumber } from "../lib/format.ts";
import type { Outreach, Priority, PriorityProgress } from "../lib/types.ts";
import { OUTREACH_COLS } from "../components/TodayCrm.tsx";
import { AddPriority, AskClaude, PriorityCard } from "../components/PriorityCard.tsx";
import { MandateCard } from "../components/MandateCard.tsx";
import Deck from "../components/Deck.tsx";
import { TodayBrief } from "../components/TodayBrief.tsx";
import { BackgroundBd } from "../components/BackgroundBd.tsx";
import { Icon } from "../components/Brand.tsx";
import { ErrorBox, Loading, useTitle } from "../components/ui.tsx";

const SHOW_FIRST = 3;

export function usePriorities() {
  return useLoad(prioritiesLoad, "priorities");
}

/**
 * The front page, top to bottom: Today (the morning brief with Do now), the signed mandates beside the draft deck,
 * then Background BD. Everything else lives under More.
 */
export default function Focus() {
  useTitle("Focus");
  const { data, error, loading, reload } = usePriorities();
  const priorities = data?.priorities ?? [];
  return (
    <div className="focus">
      <TodayBrief />

      <div className="focus-grid" id="signed-mandates">
        <section className="focus-col" aria-labelledby="h-priorities">
          <div className="focus-sec">
            <h2 id="h-priorities" tabIndex={-1}>Signed mandates</h2>
            <Link to="/priorities" className="small">Edit priorities</Link>
          </div>
          {error && !data ? (
            <ErrorBox error={error} onRetry={reload} />
          ) : loading && !data ? (
            <Loading what="Getting your mandates…" />
          ) : (
            <SignedMandates priorities={priorities} progress={data?.progress ?? new Map()} onChanged={reload} />
          )}
        </section>

        <section className="focus-col focus-do" aria-labelledby="h-drafts">
          <div className="focus-sec">
            <h2 id="h-drafts">Drafts to approve</h2>
            <Link to="/review" className="small">Open full screen</Link>
          </div>
          <Deck priorities={priorities} onChanged={reload} />
          <Replies priorities={priorities} />
        </section>
      </div>

      <BackgroundBd />
    </div>
  );
}

/**
 * The signed mandates: one card per mandate (priorities on the same deal share a card), the top three
 * priorities on screen and the rest one tap away. Each card shows the paperwork, the deal's next step and the
 * best people in Kuran's own network for it.
 */
function SignedMandates({ priorities, progress, onChanged }: {
  priorities: Priority[];
  progress: Map<string, PriorityProgress>;
  onChanged: () => void;
}) {
  const [more, setMore] = useState(false);
  const active = activeInOrder(priorities);
  const ids = [...new Set(active.flatMap((p) => p.deal_ids ?? []))].sort();
  const { data: deals } = useLoad(() => priorityDeals(ids), `deals-${ids.join(",")}`);
  const dealMap = deals ?? new Map();
  const groups = groupPriorities(active, (id) => dealMap.get(id)?.deal ?? null);
  const { shown, hidden } = splitVisible(groups, SHOW_FIRST);
  const list = more ? groups : shown;
  const nextRank = Math.max(0, ...priorities.map((p) => p.rank)) + 1;
  return (
    <div className="plist">
      {active.length === 0 && <p className="empty">No live mandates. Add the one thing you most want to close this week.</p>}
      {list.map((g, i) => (
        <MandateCard key={g.key} defaultOpen={i === 0} g={g} deals={dealMap} progress={progress} all={active} onChanged={onChanged} />
      ))}
      {!more && hidden.length > 0 && (
        <button type="button" className="padd" onClick={() => setMore(true)}>
          Show {hidden.length === 1 ? hidden[0].name : `${hidden.length} more`}
        </button>
      )}
      {(more || hidden.length === 0) && <AddPriority nextRank={nextRank} onAdded={onChanged} />}
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

async function loadRepliesClean() {
  return withoutParked(await loadReplies());
}

/** Replies received: collapsed by default, each with one button that gets Claude to draft the answer. */
function Replies({ priorities }: { priorities: Priority[] }) {
  const { data } = useLoad(loadRepliesClean, "replies");
  const rows = data ?? [];
  const rank = new Map(priorities.map((p) => [p.id, p.rank]));
  return (
    <details className="waiting" id="waiting">
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
