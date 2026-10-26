// Engine › Best to work next: the top 20 from bd_queue (routed to a mandate first), each with its stage and the
// one-click actions, plus ticks for working several at once. Clear it top-down.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useLoad } from "../lib/useLoad.ts";
import { bestNext, type BestRow } from "../lib/sequencer-data.ts";
import { shownStage, useSeqState } from "../lib/stageStore.ts";
import type { SeqOpp } from "../lib/sequencer.ts";
import { fmtMW, fmtNumber } from "../lib/format.ts";
import { Empty, ErrorBox, ExtLink, LineBadge, Loading } from "./ui.tsx";
import { SelectionBar, SeqActions, StageChip } from "./Sequencer.tsx";

const toSeq = (r: BestRow): SeqOpp => ({ id: r.opportunity_id, title: r.title, org: r.legal_name, evidence: r.evidence_url, stage: r.stage });

export default function BestNext() {
  const { data, error, loading, reload } = useLoad(() => bestNext(20), "best-next");
  const seq = useSeqState();
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Loading what="Ranking what to work next…" />;
  const rows = data ?? [];
  if (rows.length === 0) return <Empty>Nothing unworked in the queue. The engine adds more after the morning run.</Empty>;
  const stageOf = (r: BestRow) => shownStage(seq, r.opportunity_id, r.stage);
  const live = rows.filter((r) => stageOf(r) !== "dismissed");
  const tierA = live.filter((r) => r.tier === "A");
  const toggle = (id: string) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const pickedOpps = rows.filter((r) => picked.has(r.opportunity_id)).map((r) => ({ ...toSeq(r), stage: stageOf(r) }));

  return (
    <section className="best" aria-label="Best to work next">
      <div className="best-head">
        <p>
          {fmtNumber(tierA.length)} routed to a signed mandate, {fmtNumber(live.length - tierA.length)} background. Tick several to work them in one chat (15 a chat).
        </p>
        {tierA.length > 0 && (
          <button type="button" className="link-btn" onClick={() => setPicked(new Set(tierA.map((r) => r.opportunity_id)))}>
            Select the {fmtNumber(tierA.length)} routed
          </button>
        )}
      </div>
      <ol className="best-list">
        {rows.map((r) => {
          const st = stageOf(r);
          const on = picked.has(r.opportunity_id);
          const score = Number(r.bd_score);
          return (
            <li key={r.opportunity_id} className={`best-row${on ? " on" : ""}${st === "dismissed" ? " dim" : ""}`}>
              <input type="checkbox" checked={on} onChange={() => toggle(r.opportunity_id)} aria-label={`Select ${r.title}`} />
              <div className="best-score">
                <b title="Business-development score">{Number.isFinite(score) ? fmtNumber(score) : "—"}</b>
                <span className={`best-tier${r.tier === "A" ? " a" : ""}`} title={r.tier === "A" ? "Routed to a signed mandate" : "Background business development"}>
                  {r.tier === "A" ? "Routed" : "Background"}
                </span>
              </div>
              <div className="best-main">
                <span className="best-title"><Link to={`/opportunities/${r.opportunity_id}`}>{r.title}</Link></span>
                <span className="best-why">
                  {r.priority ? <>Fits <b>priority {r.priority.rank}: {r.priority.title}</b></> : r.tier === "A" ? "Fits a signed mandate" : "No mandate yet: worth opening a relationship"}
                </span>
                <div className="best-meta">
                  <StageChip id={r.opportunity_id} stage={r.stage} />
                  <LineBadge line={r.line} />
                  {r.country && <span>{r.country}</span>}
                  {r.mw ? <span className="mono">{fmtMW(r.mw)}</span> : null}
                  {r.legal_name && <span>{r.legal_name}</span>}
                  {r.evidence_url && <ExtLink url={r.evidence_url}>Evidence</ExtLink>}
                </div>
                <SeqActions opps={[toSeq(r)]} small onChanged={reload} />
              </div>
            </li>
          );
        })}
      </ol>
      {pickedOpps.length > 0 && (
        <div className="seq-sticky">
          <SelectionBar opps={pickedOpps} onClear={() => setPicked(new Set())} onChanged={reload} />
        </div>
      )}
    </section>
  );
}
