import { useEffect, useRef, useState } from "react";
import { bdCountsLoad, bdLeadsLoad } from "../lib/data.ts";
import { useLoad } from "../lib/useLoad.ts";
import { CACHE_TTL_MS } from "../lib/cache.ts";
import { BD_PER_EVENING, BD_PROCESS_NOW, pipelineStrip, processNowPrompt } from "../lib/brief.ts";
import { leadQueues, newLeadCounts } from "../lib/leads.ts";
import { AskClaude } from "./PriorityCard.tsx";
import { Icon } from "./Brand.tsx";
import { LeadQueue } from "./LeadQueue.tsx";
import { useLeadDecide } from "./useLeadDecide.ts";

/**
 * Business development running in the background: the engine's opportunities that no signed mandate has claimed,
 * turned into named people each evening. Kuran approves or dismisses here, exactly as on a mandate card.
 */
export function BackgroundBd() {
  const leadsQ = useLoad(bdLeadsLoad, "bd-leads");
  const countsQ = useLoad(bdCountsLoad, "bd-counts");
  const { over, decideLeads } = useLeadDecide();
  const [sent, setSent] = useState<string[]>([]);
  const rows = leadsQ.data ?? [];
  const q = leadQueues(rows, null, over);
  const waiting = newLeadCounts(rows, over).get(null) ?? 0;
  const strip = pipelineStrip({ routed: countsQ.data?.routed ?? null, background: countsQ.data?.background ?? null, waiting });
  const reload = leadsQ.reload;
  // A Claude chat may have filled the queue while the tab was away: look again when Kuran comes back, at most every ten minutes.
  const lastLoad = useRef(Date.now());
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastLoad.current < CACHE_TTL_MS) return;
      lastLoad.current = Date.now();
      reload();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [reload]);

  const process = (
    <AskClaude className="btn lead-find" prompt={processNowPrompt()}><Icon.claude />Process {BD_PROCESS_NOW} now</AskClaude>
  );
  return (
    <section className="bd" id="bd" aria-labelledby="h-bd">
      <div className="focus-sec bd-head">
        <h2 id="h-bd" tabIndex={-1}>Background BD</h2>
        {process}
      </div>
      <p className="bd-strip" aria-label="Engine pipeline">
        <span className="bd-strip-k">Engine</span>
        {strip.map((s) => (
          <span key={s.label} className="bd-seg"><b>{s.n}</b> {s.label}</span>
        ))}
      </p>
      <LeadQueue
        p={null}
        fresh={q.fresh}
        approved={q.approved}
        loading={leadsQ.loading}
        onDecide={(r, st) => void decideLeads(r, st)}
        sent={sent}
        onSent={(ids) => setSent((x) => [...new Set([...x, ...ids])])}
        find={null}
        emptyText={`No background leads waiting. The evening run adds ${BD_PER_EVENING} more, or process ${BD_PROCESS_NOW} now.`}
      />
    </section>
  );
}
