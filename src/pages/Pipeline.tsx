import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { contactUpdate, dealUpdate, pipelineLoad } from "../lib/data.ts";
import { useLoad } from "../lib/useLoad.ts";
import { fmtDay, ukToday } from "../lib/crm.ts";
import { fmtNumber } from "../lib/format.ts";
import { friendlyError } from "../lib/rules.ts";
import { calendarUrl, gmailSearchUrl, nudgePrompt, overdueLabel, pipelineRows, type PipeRow } from "../lib/today.ts";
import { AskClaude } from "../components/PriorityCard.tsx";
import { Icon } from "../components/Brand.tsx";
import { toast } from "../components/Toast.tsx";
import { ErrorBox, Loading, useTitle } from "../components/ui.tsx";

const DEAD_DEAL = "Closed – lost";
const DEAD_CONTACT = "Nurture";
const FIRST = 40;

/**
 * Pipeline: open deals and warm contacts in one list, stalled first. Each row says who, what is next and how late,
 * with one button that has Claude draft the nudge as a Gmail draft in the existing thread, and Close as dead.
 */
export default function Pipeline() {
  useTitle("Pipeline");
  const { data, error, loading, reload } = useLoad(pipelineLoad, "pipeline");
  const [closed, setClosed] = useState<Map<string, string | null>>(() => new Map());
  const [all, setAll] = useState(false);
  const today = ukToday();
  const rows = useMemo(
    () => (data ? pipelineRows(data.deals, data.contacts, today, data.people) : []).filter((r) => !closed.has(`${r.kind}:${r.id}`)),
    [data, today, closed],
  );
  const stalled = rows.filter((r) => r.stalled);
  const shown = all ? rows : rows.slice(0, Math.max(FIRST, stalled.length));

  const closeDead = async (r: PipeRow) => {
    const key = `${r.kind}:${r.id}`;
    const before = r.stage;
    setClosed((m) => new Map(m).set(key, before));
    const back = () => setClosed((m) => { const n = new Map(m); n.delete(key); return n; });
    try {
      if (r.kind === "deal") await dealUpdate(r.id, { stage: DEAD_DEAL });
      else await contactUpdate(r.id, { stage: DEAD_CONTACT });
      toast(r.kind === "deal" ? `Closed ${r.what} as lost.` : `Moved ${r.who} to Nurture.`, true, {
        ms: 8000,
        actions: [{
          label: "Undo",
          primary: true,
          run: () => {
            const undo = r.kind === "deal" ? dealUpdate(r.id, { stage: before }) : contactUpdate(r.id, { stage: before });
            void undo.then(() => { back(); toast("Undone."); }, (e) => toast(friendlyError(e), false));
          },
        }],
      });
    } catch (e) {
      back();
      toast(friendlyError(e), false);
    }
  };

  return (
    <div className="pipe">
      <header className="focus-head">
        <h1>Pipeline</h1>
        <p className="focus-lede">
          {data ? (stalled.length > 0 ? `${fmtNumber(stalled.length)} stalled, oldest first. Draft the nudge or close it.` : "Nothing stalled. Every deal and warm contact has a date ahead.") : "Deals and warm contacts, stalled first."}
        </p>
      </header>
      {error && !data ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading what="Getting your pipeline…" />
      ) : rows.length === 0 ? (
        <p className="empty">No open deals or warm contacts. When someone replies, they show up here.</p>
      ) : (
        <>
          <ol className="pipe-list">
            {shown.map((r, i) => (
              <Row key={`${r.kind}:${r.id}`} r={r} divider={i > 0 && r.stalled !== shown[i - 1].stalled} onDead={() => void closeDead(r)} />
            ))}
          </ol>
          {rows.length > shown.length && (
            <button type="button" className="padd" onClick={() => setAll(true)}>Show all {fmtNumber(rows.length)}</button>
          )}
        </>
      )}
      <p className="muted small pipe-foot">Deals: <Link to="/deals">all deals</Link>. People: <Link to="/contacts">all contacts</Link>.</p>
    </div>
  );
}

function Row({ r, divider, onDead }: { r: PipeRow; divider: boolean; onDead: () => void }) {
  const late = overdueLabel(r);
  const href = r.kind === "deal" ? `/deals?id=${r.id}` : `/contacts?id=${r.id}`;
  return (
    <li className={`pipe-row${r.stalled ? " is-stalled" : ""}${divider ? " is-first-calm" : ""}`}>
      <div className="pipe-who">
        <Link to={href} className="pipe-name">{r.who}</Link>
        <span className="pipe-what">
          <span className={`pipe-kind k-${r.kind}`}>{r.kind === "deal" ? "Deal" : "Contact"}</span>
          {r.kind === "deal" ? r.what : [r.company, r.stage].filter(Boolean).join(", ")}
        </span>
      </div>
      <p className="pipe-next">{r.next}</p>
      <p className={`pipe-late${r.stalled ? " is-late" : ""}`}>{late || (r.due ? `Due ${fmtDay(r.due)}` : "")}</p>
      <div className="pipe-acts">
        <AskClaude className={`btn small${r.stalled ? " primary" : ""}`} prompt={nudgePrompt(r)}><Icon.claude />Draft the nudge</AskClaude>
        <a className="btn small ghost" href={gmailSearchUrl(r.email || [r.who, r.company].filter(Boolean).join(" "))} target="_blank" rel="noopener noreferrer" title="Find the thread in Gmail">Gmail<Icon.external /></a>
        <a className="btn small ghost" href={calendarUrl(`${r.who}${r.company && r.company !== r.who ? ` (${r.company})` : ""}: ${r.next}`, `${r.what}. Next step: ${r.next}`)} target="_blank" rel="noopener noreferrer" title="Add a Google Calendar event">Calendar<Icon.external /></a>
        <button type="button" className="btn small ghost" onClick={onDead}>Close as dead</button>
      </div>
    </li>
  );
}
