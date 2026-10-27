import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLoad } from "../lib/useLoad.ts";
import { buildPriorities, prioritiesRaw, priorityDeals } from "../lib/data.ts";
import { useCached } from "../lib/cache.ts";
import type { Loaded } from "../lib/useLoad.ts";
import { activeInOrder } from "../lib/focus.ts";
import { groupPriorities, splitVisible } from "../lib/mandates.ts";
import type { Priority, PriorityProgress } from "../lib/types.ts";
import { AddPriority, PriorityCard } from "../components/PriorityCard.tsx";
import { MandateCard } from "../components/MandateCard.tsx";
import { BackgroundBd } from "../components/BackgroundBd.tsx";
import { ErrorBox, Loading, useTitle } from "../components/ui.tsx";

const SHOW_FIRST = 3;

/** Priorities through the ten-minute cache; reload() fetches fresh (after an edit). */
export function usePriorities(): Loaded<ReturnType<typeof buildPriorities>> {
  const q = useCached(prioritiesRaw, "priorities");
  const data = useMemo(() => (q.data ? buildPriorities(q.data) : null), [q.data]);
  return { ...q, data };
}

/**
 * The Leads desk (under More): every signed mandate with its New leads and best people in Kuran's network, then
 * Background BD. This is where leads are approved in bulk and handed to Claude for outbound; Today stays light.
 */
export default function Leads() {
  useTitle("Leads desk");
  const { data, error, loading, reload } = usePriorities();
  const priorities = data?.priorities ?? [];
  return (
    <div className="focus leads-desk">
      <header className="focus-head">
        <h1>Leads desk</h1>
        <p className="focus-lede">New leads and your network for each signed mandate, then background BD. Approve here; Claude writes the outbound.</p>
      </header>
      <section className="focus-col" id="signed-mandates" aria-labelledby="h-priorities">
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
      <BackgroundBd />
    </div>
  );
}

/**
 * The signed mandates: one card per mandate (priorities on the same deal share a card), the top three
 * priorities on screen and the rest one tap away. Each card shows the paperwork, the deal's next step and the
 * best people in Kuran's own network for it.
 */
export function SignedMandates({ priorities, progress, onChanged }: {
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
