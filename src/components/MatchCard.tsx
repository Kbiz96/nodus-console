import { Link } from "react-router-dom";
import type { MatchCardRow } from "../lib/types.ts";
import { fmtDate } from "../lib/format.ts";
import { feedbackLine } from "../lib/feedback.ts";
import { ExtLink, GateBadge, LineBadge, Score, ScoreBars, StatusBadge } from "./ui.tsx";
import MatchActions from "./MatchActions.tsx";

export default function MatchCard({ m, actions = true, onChanged }: { m: MatchCardRow; actions?: boolean; onChanged?: () => void }) {
  const ex = m.explanation ?? {};
  const why = Array.isArray(ex.why) ? ex.why : [];
  const unknowns = Array.isArray(ex.unknowns) ? ex.unknowns : [];
  const evidence = Array.isArray(ex.evidence) ? ex.evidence : [];
  const learned = feedbackLine(ex.feedback);
  // The engine also adds the down-weight to "why"; show it once, in its own note.
  const whyShown = learned ? why.filter((w) => !String(w).startsWith("Down-weighted ")) : why;
  return (
    <article className="card match">
      <header className="match-head">
        <Score value={m.total_score} />
        <div className="match-title">
          <h3>
            <Link to={`/matches/${m.id}`}>{m.thesis || "Possible match"}</Link>
          </h3>
          <div className="meta">
            <LineBadge line={m.line} />
            <StatusBadge status={m.status} />
            <span className="muted">Found {fmtDate(m.created_at)}</span>
          </div>
        </div>
      </header>

      <ul className="sides">
        {m.mandate_label && (
          <li>
            <span className="side-tag">Mandate</span>
            <Link to={`/mandates?edit=${m.mandate_id}`}>{m.mandate_label}</Link>
          </li>
        )}
        {m.supply_id && (
          <li>
            <span className="side-tag">Supply</span>
            <Link to={`/opportunities/${m.supply_id}`}>{m.supply_title}</Link> <GateBadge gate={m.supply_gate} />
          </li>
        )}
        {m.need_id && (
          <li>
            <span className="side-tag">Need</span>
            <Link to={`/opportunities/${m.need_id}`}>{m.need_title}</Link> <GateBadge gate={m.need_gate} />
          </li>
        )}
      </ul>

      <div className="match-body">
        <ScoreBars scores={m.scores} />
        <div className="match-text">
          {whyShown.length > 0 && (
            <>
              <h4>Why</h4>
              <ul>{whyShown.map((w, i) => <li key={i}>{String(w)}</li>)}</ul>
            </>
          )}
          {learned && (
            <p className="note small" title={`Score before your feedback: ${ex.feedback?.raw_total ?? "—"}`}>
              Learned from your rejections. {learned}
            </p>
          )}
          {unknowns.length > 0 && (
            <>
              <h4>Unknowns</h4>
              <ul>{unknowns.map((w, i) => <li key={i}>{String(w)}</li>)}</ul>
            </>
          )}
          {ex.next_step && (
            <>
              <h4>Next step</h4>
              <p>{String(ex.next_step)}</p>
            </>
          )}
        </div>
      </div>

      {evidence.length > 0 && (
        <details className="evidence">
          <summary>Evidence ({evidence.length})</summary>
          <ul>
            {evidence.map((e, i) => (
              <li key={i}>
                <ExtLink url={e?.url}>{e?.title || "Source"}</ExtLink>
                {e?.quote && <blockquote>{e.quote}</blockquote>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {m.status === "rejected" && m.reject_reason && <p className="muted small">Rejected: {m.reject_reason}</p>}
      {actions && <MatchActions id={m.id} status={m.status} onChanged={onChanged} />}
    </article>
  );
}
