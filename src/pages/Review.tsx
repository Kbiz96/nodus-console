import { Link, useSearchParams } from "react-router-dom";
import { activeInOrder } from "../lib/focus.ts";
import { fmtNumber } from "../lib/format.ts";
import Deck from "../components/Deck.tsx";
import { useTitle } from "../components/ui.tsx";
import { usePriorities } from "./Leads.tsx";
import { lastSentLoad } from "../lib/data.ts";
import { sendState } from "../lib/today.ts";
import { useLoad } from "../lib/useLoad.ts";

/** The review deck on its own: one draft at a time, optionally for one priority. */
export default function Review() {
  useTitle("Review");
  const [sp] = useSearchParams();
  const { data, reload } = usePriorities();
  const { data: lastSent } = useLoad(() => lastSentLoad(), "last-sent");
  const priorities = data?.priorities ?? [];
  const active = activeInOrder(priorities);
  const pid = sp.get("priority");
  const opp = sp.get("opp");
  const old = sp.get("old") === "1";
  const chosen = pid ? priorities.find((p) => p.id === pid) ?? null : null;
  const waiting = (id: string) => {
    const pr = data?.progress.get(id);
    return (pr?.drafts ?? 0) + (pr?.manual ?? 0);
  };
  return (
    <div className="review">
      <header className="focus-head">
        <h1>Review</h1>
        <p className="focus-lede">
          {old ? <>Older approved emails (written before the 27 Oct style): send, hold or skip each one. <Link to="/review">See all drafts</Link></> : opp ? <>Drafts for one opportunity. <Link to="/review">See all drafts</Link></> : chosen ? `Drafts for priority ${chosen.rank}: ${chosen.title}.` : "Every draft, email and LinkedIn, one at a time. Most days Today is enough."}
        </p>
      </header>
      {active.length > 0 && (
        <nav className="pfilter" aria-label="Which drafts">
          <Link to="/review" aria-current={!pid ? "page" : undefined}>All</Link>
          {active.map((p) => (
            <Link key={p.id} to={`/review?priority=${p.id}`} aria-current={pid === p.id ? "page" : undefined} title={p.title}>
              <b>{p.rank}</b> {p.title}
              {waiting(p.id) > 0 && <span className="pf-n">{fmtNumber(waiting(p.id))}</span>}
            </Link>
          ))}
        </nav>
      )}
      <Deck key={old ? "old" : opp ? `opp-${opp}` : pid ?? "all"} oldApproved={old} priorities={priorities} priorityId={opp || old ? null : pid} opportunityId={old ? null : opp} onChanged={reload} sendEnabled={sendState(lastSent ?? null)} />
    </div>
  );
}
