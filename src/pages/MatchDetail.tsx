import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { MATCH_CARD_COLS, enrichRequest } from "../lib/data.ts";
import { isUuid } from "../lib/filters.ts";
import { useLoad } from "../lib/useLoad.ts";
import { friendlyError } from "../lib/rules.ts";
import type { EnrichResult } from "../lib/enrich.ts";
import type { MatchCardRow } from "../lib/types.ts";
import { ENRICH_MONTHLY_CAP_CREDITS, ENRICH_PER_RUN_CAP_CREDITS } from "../config.ts";
import MatchCard from "../components/MatchCard.tsx";
import PeoplePanel from "../components/PeoplePanel.tsx";
import { ErrorBox, Loading, NotFound, useTitle } from "../components/ui.tsx";

export default function MatchDetail() {
  const { id = "" } = useParams();
  useTitle("Match");
  const [refresh, setRefresh] = useState(0);
  const { data, error, loading, reload } = useLoad(async () => {
    if (!isUuid(id)) return null;
    const r = await supabase.from("v_match_cards").select(MATCH_CARD_COLS).eq("id", id).maybeSingle();
    return must(r) as unknown as MatchCardRow | null;
  }, id);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return <NotFound what="match" />;
  return (
    <div className="stack-lg">
      <div className="stack">
        <p><Link to="/matches">← All matches</Link></p>
        <MatchCard m={data} onChanged={reload} />
      </div>
      {(data.supply_id || data.need_id) && (
        <section className="stack">
          <h2>Decision makers</h2>
          <EnrichBoth m={data} onAsked={() => setRefresh((n) => n + 1)} />
          <div className="split">
            {data.supply_id && (
              <PeoplePanel oppId={data.supply_id} heading={`Supply: ${data.supply_title ?? "opportunity"}`} oppLink compact refreshKey={refresh} />
            )}
            {data.need_id && (
              <PeoplePanel oppId={data.need_id} heading={`Need: ${data.need_title ?? "opportunity"}`} oppLink compact refreshKey={refresh} />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/** "Enrich both sides": one request per side of the match; each side answers with its own reason. */
function EnrichBoth({ m, onAsked }: { m: MatchCardRow; onAsked: () => void }) {
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<EnrichResult[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const sideOf = (opp: string) => (opp === m.supply_id ? "Supply" : opp === m.need_id ? "Need" : "Opportunity");
  const run = async () => {
    setPending(true);
    setResults(null);
    setFailure(null);
    try {
      setResults(await enrichRequest({ match: m.id }));
      onAsked();
    } catch (e) {
      setFailure(friendlyError(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="card stack">
      <p className="muted small">
        Looks up 2–4 decision makers on each side with Apollo, Clay or Vibe Prospecting. Only for Qualified or later. Uses credits
        (cap {ENRICH_PER_RUN_CAP_CREDITS} per run, {ENRICH_MONTHLY_CAP_CREDITS} a month).
      </p>
      <div className="action-row">
        <button className="btn primary" disabled={pending} onClick={run}>Enrich both sides</button>
        {pending && <span className="muted small">Asking…</span>}
      </div>
      {failure && <p className="error small" role="status">{failure}</p>}
      {results && (
        <ul className="plain" role="status">
          {results.length === 0 && <li className="muted small">Nothing to enrich on this match.</li>}
          {results.map((r, i) => (
            <li key={i} className={r.ok ? "ok small" : "error small"}>
              <strong>{sideOf(r.opportunity)}:</strong> {r.why}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
