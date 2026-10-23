import { useState } from "react";
import { PriorityCard } from "../components/PriorityCard.tsx";
import { ErrorBox, Loading, useTitle } from "../components/ui.tsx";
import { PriorityList, usePriorities } from "./Focus.tsx";

/** Every priority: the live ones to edit and reorder, then paused and done ones to bring back. */
export default function Priorities() {
  useTitle("Priorities");
  const { data, error, loading, reload } = usePriorities();
  const [showOff, setShowOff] = useState(false);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Loading what="Getting your priorities…" />;
  const priorities = data?.priorities ?? [];
  const off = priorities.filter((p) => p.status !== "active");
  return (
    <div className="priorities-page">
      <header className="focus-head">
        <h1>Priorities</h1>
        <p className="focus-lede">The few things Nodus is trying to close, in order. Claude drafts for these first.</p>
      </header>
      <PriorityList priorities={priorities} progress={data?.progress ?? new Map()} onChanged={reload} showAll />
      {off.length > 0 && (
        <section className="stack">
          <button type="button" className="padd" aria-expanded={showOff} onClick={() => setShowOff((v) => !v)}>
            {showOff ? "Hide" : "Show"} paused and done ({off.length})
          </button>
          {showOff && (
            <div className="plist">
              {off.map((p) => <PriorityCard key={p.id} p={p} pr={data?.progress.get(p.id)} above={null} below={null} onChanged={reload} />)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
