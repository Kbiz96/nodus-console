import { useState } from "react";
import { Link } from "react-router-dom";
import { priorityDeals } from "../lib/data.ts";
import { useLoad } from "../lib/useLoad.ts";
import { activeInOrder } from "../lib/focus.ts";
import { dealNext, groupPriorities, signedState } from "../lib/mandates.ts";
import { fmtDay } from "../lib/crm.ts";
import type { Deal, Priority, PriorityProgress } from "../lib/types.ts";
import { MandateCard } from "./MandateCard.tsx";
import { HandoffContext } from "./handoff.ts";
import { Icon } from "./Brand.tsx";

/**
 * Signed mandates on Today: one line each (rank, title, paperwork, next step, overdue flag). A tap opens the full
 * card underneath, without its Claude buttons (those live on the Leads desk).
 */
export function MandateRows({ priorities, progress, onChanged }: {
  priorities: Priority[];
  progress: Map<string, PriorityProgress>;
  onChanged: () => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const active = activeInOrder(priorities);
  const ids = [...new Set(active.flatMap((p) => p.deal_ids ?? []))].sort();
  const { data: deals } = useLoad(() => priorityDeals(ids), `deals-${ids.join(",")}`);
  const dealMap = deals ?? new Map<string, Deal>();
  const groups = groupPriorities(active, (id) => dealMap.get(id)?.deal ?? null);
  if (groups.length === 0) return <p className="empty">No live mandates. Add one on <Link to="/priorities">Priorities</Link>.</p>;
  return (
    <ol className="mrows">
      {groups.map((g) => {
        const linked = g.dealIds.map((id) => dealMap.get(id)).filter((d): d is Deal => Boolean(d));
        const signed = signedState(linked);
        const next = dealNext(linked);
        const nextText = next?.text || g.members[0].next_action || "";
        const open = openKey === g.key;
        const rank = Math.min(...g.members.map((m) => m.rank));
        return (
          <li key={g.key} className={`mrow${open ? " is-open" : ""}${next?.overdue ? " is-late" : ""}`}>
            <button type="button" className="mrow-line" aria-expanded={open} aria-controls={`mrow-${g.key}`} onClick={() => setOpenKey(open ? null : g.key)}>
              <span className="mrow-rank" aria-label={`Priority ${rank}`}>{rank}</span>
              <span className="mrow-title">{g.name}</span>
              <span className="mrow-chips">
                {signed.chips.map((c) => <span key={c.label} className={`mchip t-${c.tone}`}>{c.label}</span>)}
                {signed.state === "none" && <span className="mchip t-off">No deal linked</span>}
              </span>
              <span className="mrow-next">{nextText || <span className="muted">No next step set</span>}</span>
              {next?.overdue ? (
                <span className="mrow-late">Overdue{next.date ? ` since ${fmtDay(next.date)}` : ""}</span>
              ) : next?.date ? (
                <span className="mrow-due">{fmtDay(next.date)}</span>
              ) : <span className="mrow-due" />}
              <Icon.chevron />
            </button>
            {open && (
              <div className="mrow-card" id={`mrow-${g.key}`}>
                <HandoffContext.Provider value={false}>
                  <MandateCard g={g} deals={dealMap} progress={progress} all={active} onChanged={onChanged} alwaysOpen />
                </HandoffContext.Provider>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
