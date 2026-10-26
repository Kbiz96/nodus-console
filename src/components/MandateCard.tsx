import { useState } from "react";
import { Link } from "react-router-dom";
import { priorityNetwork } from "../lib/data.ts";
import { useLoad } from "../lib/useLoad.ts";
import { priorityPrompt } from "../lib/focus.ts";
import { fmtDay } from "../lib/crm.ts";
import { fmtNumber, safeHref } from "../lib/format.ts";
import {
  dealNext,
  draftForPrompt,
  isSupplyPriority,
  networkHeading,
  quotesPrompt,
  scoreWidth,
  signedState,
  titleTail,
  workstreamLabel,
  type MandateGroup,
} from "../lib/mandates.ts";
import type { Deal, NetworkRow, Priority, PriorityProgress } from "../lib/types.ts";
import { AskClaude, AskMenu, PriorityEditor, ProgressStrip } from "./PriorityCard.tsx";
import { Icon } from "./Brand.tsx";
import { ErrorBox } from "./ui.tsx";

const NET_FIRST = 5;

/**
 * One signed mandate: the paper (from the linked deal), the deal's next step, and one workstream per priority.
 * Two priorities on the same mandate (Al-Risha offtakers and investors) share one card with a switch.
 */
export function MandateCard({ g, deals, progress, all, onChanged }: {
  g: MandateGroup<Priority>;
  deals: Map<string, Deal>;
  progress: Map<string, PriorityProgress>;
  /** Every active priority in rank order, for move up and down. */
  all: Priority[];
  onChanged: () => void;
}) {
  const [tab, setTab] = useState(0);
  const p = g.members[Math.min(tab, g.members.length - 1)];
  const linked = g.dealIds.map((id) => deals.get(id)).filter((d): d is Deal => Boolean(d));
  const signed = signedState(linked);
  const next = dealNext(linked);
  const dealId = linked[0]?.id;
  const idx = all.findIndex((x) => x.id === p.id);
  const headId = `m-${g.key}`;
  return (
    <article className={`mcard${signed.state === "signed" ? " is-signed" : ""}`} aria-labelledby={headId}>
      <div className="mcard-rank" aria-label={`Priority ${p.rank}`}>{p.rank}</div>
      <div className="mcard-main">
      <header className="mcard-head">
        <div className="mcard-id">
          <div className="mcard-title">
            <h3 id={headId}>{g.name}</h3>
            {signed.badge && <span className={`seal ${signed.state}`}>{signed.badge}</span>}
          </div>
          {(signed.chips.length > 0 || signed.state === "none") && (
            <ul className="mchips" aria-label="Paperwork">
              {signed.chips.map((c) => <li key={c.label} className={`t-${c.tone}`}>{c.label}</li>)}
              {signed.state === "none" && <li className="t-off">No deal linked</li>}
            </ul>
          )}
          {next && <DealNextLine text={next.text} date={next.date} overdue={next.overdue} dealId={dealId} />}
        </div>
      </header>

      {g.members.length > 1 && (
        <div className="mtabs" role="tablist" aria-label="Workstreams">
          {g.members.map((m, i) => {
            const pr = progress.get(m.id);
            const waiting = (pr?.drafts ?? 0) + (pr?.manual ?? 0);
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                id={`tab-${m.id}`}
                aria-selected={i === tab}
                aria-controls={`ws-${g.key}`}
                onClick={() => setTab(i)}
              >
                <b>{m.rank}</b>
                <span>{workstreamLabel(m)}</span>
                {waiting > 0 && <i aria-label={`${waiting} waiting`}>{fmtNumber(waiting)}</i>}
              </button>
            );
          })}
        </div>
      )}

      <Workstream
        key={p.id}
        id={`ws-${g.key}`}
        labelledBy={g.members.length > 1 ? `tab-${p.id}` : headId}
        p={p}
        pr={progress.get(p.id)}
        above={idx > 0 ? all[idx - 1] : null}
        below={idx >= 0 && idx < all.length - 1 ? all[idx + 1] : null}
        showTail={g.members.length === 1}
        onChanged={onChanged}
      />
      </div>
    </article>
  );
}

function DealNextLine({ text, date, overdue, dealId }: { text: string; date: string | null; overdue: boolean; dealId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`mdeal${overdue ? " overdue" : ""}`}>
      <p className="mdeal-when">
        {date ? (overdue ? `Deal next step was due ${fmtDay(date)}` : `Deal next step, due ${fmtDay(date)}`) : "Deal next step"}
        {dealId && <Link to={`/deals?id=${dealId}`}>Open deal</Link>}
      </p>
      {text && (
        <button type="button" className={`mdeal-text${open ? " open" : ""}`} aria-expanded={open} onClick={() => setOpen((v) => !v)} title={open ? "Show less" : "Show all"}>
          {text}
        </button>
      )}
    </div>
  );
}

/** One priority inside a mandate card: progress, the next action, Ask Claude and the people to talk to. */
function Workstream({ id, labelledBy, p, pr, above, below, showTail, onChanged }: {
  id: string;
  labelledBy: string;
  p: Priority;
  pr: PriorityProgress | undefined;
  above: Priority | null;
  below: Priority | null;
  showTail: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const drafts = (pr?.drafts ?? 0) + (pr?.manual ?? 0);
  const tail = titleTail(p.title);
  const supply = isSupplyPriority(p);
  return (
    <div className="mws" id={id} role={showTail ? undefined : "tabpanel"} aria-labelledby={labelledBy}>
      <div className="mws-head">
        <p className="mws-goal">{showTail && tail ? <span className="mws-tail">{tail.charAt(0).toUpperCase() + tail.slice(1)}. </span> : null}{p.goal}</p>
        <button type="button" className="icon-btn ghost" onClick={() => setEditing((v) => !v)} aria-expanded={editing} aria-label={editing ? `Close editing ${p.title}` : `Edit ${p.title}`} title="Edit">
          {editing ? <Icon.close /> : <Icon.pencil />}
        </button>
      </div>
      {editing ? (
        <PriorityEditor p={p} above={above} below={below} onDone={() => { setEditing(false); onChanged(); }} />
      ) : (
        <>
          <ProgressStrip pr={pr} />
          {p.next_action && <p className="pcard-next"><span>Next</span>{p.next_action}</p>}
          <div className="pcard-actions">
            {supply ? (
              <AskClaude prompt={quotesPrompt(p)}><Icon.claude />Ask Claude: get quotes</AskClaude>
            ) : (
              <AskClaude prompt={priorityPrompt(p)}><Icon.claude />Ask Claude</AskClaude>
            )}
            {drafts > 0 && (
              <Link className="btn big" to={`/review?priority=${p.id}`}>Review {fmtNumber(drafts)} {drafts === 1 ? "draft" : "drafts"}</Link>
            )}
            <AskMenu p={p} extra={supply ? [{ label: "Run the next action", prompt: priorityPrompt(p) }] : []} />
          </div>
          <NetworkList p={p} />
        </>
      )}
    </div>
  );
}

/** The best people already in the CRM for this priority (priority_network), five first, up to fifteen. */
function NetworkList({ p }: { p: Priority }) {
  const { data, error, loading, reload } = useLoad(() => priorityNetwork(p.id, 15), `net-${p.id}`);
  const [all, setAll] = useState(false);
  const rows = data ?? [];
  const shown = all ? rows : rows.slice(0, NET_FIRST);
  const heading = networkHeading(p);
  return (
    <section className="net" aria-label={heading}>
      <div className="net-head">
        <h4>{heading}</h4>
        {rows.length > 0 && <span className="muted small">{rows.length === 1 ? "1 person" : `${fmtNumber(rows.length)} people`}, best fit first</span>}
      </div>
      {error && !data ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <p className="net-empty muted small" role="status">Finding people in your network…</p>
      ) : rows.length === 0 ? (
        <p className="net-empty muted small">Nobody in your CRM fits this yet. Ask Claude to find people.</p>
      ) : (
        <ol className="net-list">
          {shown.map((r) => <NetworkPerson key={r.contact_id} r={r} p={p} />)}
        </ol>
      )}
      {rows.length > NET_FIRST && (
        <button type="button" className="net-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? "Show the top 5" : `See all ${fmtNumber(rows.length)}`}
        </button>
      )}
    </section>
  );
}

function NetworkPerson({ r, p }: { r: NetworkRow; p: Priority }) {
  const role = [r.title, r.company].filter(Boolean).join(", ");
  const li = safeHref(r.linkedin);
  const reasons = r.reasons ?? [];
  const w = scoreWidth(r.score);
  return (
    <li className="net-row">
      <div className="net-who">
        <Link to={`/contacts?id=${r.contact_id}`} className="net-name">{r.name || "Unnamed contact"}</Link>
        {role && <span className="net-role">{role}</span>}
      </div>
      <div className="net-score" title={`Fit score ${fmtNumber(r.score)}`} aria-label={`Fit score ${fmtNumber(r.score)}`}>
        <span className="net-bar" aria-hidden><span style={{ width: `${w}%` }} /></span>
        <span className="net-num">{fmtNumber(r.score)}</span>
      </div>
      {reasons.length > 0 && (
        <ul className="net-why" aria-label="Why them">
          {reasons.map((x) => <li key={x}>{x}</li>)}
        </ul>
      )}
      <div className="net-act">
        <AskClaude className="btn small net-draft" prompt={draftForPrompt(r, p)}><Icon.claude />Draft for me</AskClaude>
        {li && (
          <a className="btn small ghost" href={li} target="_blank" rel="noopener noreferrer">LinkedIn<Icon.external /></a>
        )}
        <Link className="btn small ghost" to={`/contacts?id=${r.contact_id}`}>Contact</Link>
      </div>
    </li>
  );
}
