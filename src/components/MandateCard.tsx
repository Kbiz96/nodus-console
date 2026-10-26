import { useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { contactNames, networkDismiss, networkDismissals, networkUndismiss, priorityNetwork } from "../lib/data.ts";
import { useLoad } from "../lib/useLoad.ts";
import { priorityPrompt } from "../lib/focus.ts";
import { fmtDay } from "../lib/crm.ts";
import { fmtNumber, safeHref } from "../lib/format.ts";
import {
  DISMISS_DAYS,
  DISMISS_REASONS,
  batchDraftPrompt,
  dealNext,
  dismissalRows,
  isActiveDismissal,
  isSupplyPriority,
  networkHeading,
  quotesPrompt,
  scoreWidth,
  signedState,
  titleTail,
  withoutDismissed,
  workstreamLabel,
  type Dismissal,
  type MandateGroup,
} from "../lib/mandates.ts";
import { friendlyError } from "../lib/rules.ts";
import type { Deal, NetworkRow, Priority, PriorityProgress } from "../lib/types.ts";
import { AskClaude, AskMenu, PriorityEditor, ProgressStrip, openInClaude } from "./PriorityCard.tsx";
import { toast } from "./Toast.tsx";
import { Icon } from "./Brand.tsx";
import { ErrorBox } from "./ui.tsx";

const NET_FIRST = 5;
const NET_MAX = 15;
/** Ask for a few more than we show, so the list stays full after "Not now" people are filtered out. */
const NET_ASK = 20;

/** Picks and "Sent to Claude" marks, kept per priority so switching tabs does not lose them. */
type PerPriority = Record<string, string[]>;

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
  const [picked, setPicked] = useState<PerPriority>({});
  const [sent, setSent] = useState<PerPriority>({});
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
                {(picked[m.id]?.length ?? 0) > 0 && i !== tab && <i className="mtab-picked" aria-label={`${picked[m.id].length} selected`}><Icon.check />{fmtNumber(picked[m.id].length)}</i>}
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
        picked={picked[p.id] ?? []}
        onPick={(ids) => setPicked((x) => ({ ...x, [p.id]: ids }))}
        sent={sent[p.id] ?? []}
        onSent={(ids) => setSent((x) => ({ ...x, [p.id]: [...new Set([...(x[p.id] ?? []), ...ids])] }))}
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
function Workstream({ id, labelledBy, p, pr, above, below, showTail, onChanged, picked, onPick, sent, onSent }: {
  id: string;
  labelledBy: string;
  p: Priority;
  pr: PriorityProgress | undefined;
  above: Priority | null;
  below: Priority | null;
  showTail: boolean;
  onChanged: () => void;
  picked: string[];
  onPick: (ids: string[]) => void;
  sent: string[];
  onSent: (ids: string[]) => void;
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
          <NetworkList p={p} picked={picked} onPick={onPick} sent={sent} onSent={onSent} />
        </>
      )}
    </div>
  );
}

/** Who a message is about: "Leila Nasser", "Leila Nasser and Omar Haddad", "3 people". */
function whoLabel(names: (string | null | undefined)[]): string {
  const n = names.length;
  if (n === 1) return names[0] || "1 person";
  if (n === 2 && names.every(Boolean)) return `${names[0]} and ${names[1]}`;
  return `${n} people`;
}

/**
 * The best people already in the CRM for this priority (priority_network), five first, up to fifteen.
 * Tick people (or "Select top 5"), then draft them all in one Claude chat in the Nodus project, or say
 * "Not now" to hide them from this priority for 60 days.
 */
function NetworkList({ p, picked, onPick, sent, onSent }: {
  p: Priority;
  picked: string[];
  onPick: (ids: string[]) => void;
  sent: string[];
  onSent: (ids: string[]) => void;
}) {
  const { data, error, loading, reload } = useLoad(async () => {
    const [rows, ds] = await Promise.all([priorityNetwork(p.id, NET_ASK), networkDismissals([p.id])]);
    return { rows, ds };
  }, `net-${p.id}`);
  const [all, setAll] = useState(false);
  /** Changes made here before the next reload: a dismissal (row) or a bring-back (null), by contact id. */
  const [over, setOver] = useState<Map<string, Dismissal | null>>(new Map());
  const [showGone, setShowGone] = useState(false);

  const raw = data?.rows ?? [];
  const known = new Map(raw.map((r) => [r.contact_id, r]));
  const ds = [
    ...(data?.ds ?? []).filter((d) => !over.has(d.contact_id)),
    ...[...over.values()].filter((d): d is Dismissal => d !== null),
  ].filter((d) => d.priority_id === p.id && isActiveDismissal(d));
  const rows = withoutDismissed(raw, ds, p.id, NET_MAX);
  const shown = all ? rows : rows.slice(0, NET_FIRST);
  const sentSet = new Set(sent);
  const visibleIds = new Set(rows.map((r) => r.contact_id));
  const sel = picked.filter((id) => visibleIds.has(id) && !sentSet.has(id));
  const selSet = new Set(sel);
  const pickable = shown.filter((r) => !sentSet.has(r.contact_id));
  const heading = networkHeading(p);
  const ws = workstreamLabel(p);
  const n = sel.length;

  const setOverMany = (ids: string[], value: (id: string) => Dismissal | null) =>
    setOver((m) => {
      const next = new Map(m);
      for (const id of ids) next.set(id, value(id));
      return next;
    });

  const toggle = (id: string) => onPick(selSet.has(id) ? sel.filter((x) => x !== id) : [...sel, id]);

  const draft = () => {
    const people = rows.filter((r) => selSet.has(r.contact_id));
    if (people.length === 0) return;
    openInClaude(batchDraftPrompt(people, p));
    onSent(people.map((r) => r.contact_id));
    onPick([]);
  };

  const bringBack = async (ids: string[], quiet = false) => {
    setOverMany(ids, () => null);
    try {
      await networkUndismiss(p.id, ids);
      if (!quiet) toast(`Brought back ${whoLabel(ids.map((id) => known.get(id)?.name ?? null))}.`);
    } catch (e) {
      toast(`Could not bring them back: ${friendlyError(e)}`, false);
      reload();
    }
  };

  const setReason = async (ids: string[], reason: string) => {
    const fresh = dismissalRows(p.id, ids, reason);
    setOverMany(ids, (id) => fresh.find((d) => d.contact_id === id) ?? null);
    try {
      await networkDismiss(p.id, ids, reason);
      toast(`Noted: ${reason.toLowerCase()}.`);
    } catch (e) {
      toast(`The reason was not saved: ${friendlyError(e)}`, false);
    }
  };

  const notNow = async (ids: string[]) => {
    if (ids.length === 0) return;
    const fresh = dismissalRows(p.id, ids);
    setOverMany(ids, (id) => fresh.find((d) => d.contact_id === id) ?? null);
    onPick(sel.filter((id) => !ids.includes(id)));
    try {
      await networkDismiss(p.id, ids);
    } catch (e) {
      setOverMany(ids, () => null);
      toast(`Not now did not save: ${friendlyError(e)}`, false);
      return;
    }
    toast(`Not now: ${whoLabel(ids.map((id) => known.get(id)?.name ?? null))}. Back in ${DISMISS_DAYS} days.`, true, {
      ms: 6000,
      actions: [
        { label: "Undo", primary: true, run: () => void bringBack(ids, true).then(() => toast("Undone.")) },
        ...DISMISS_REASONS.map((r) => ({ label: r, run: () => void setReason(ids, r) })),
      ],
    });
  };

  return (
    <section className="net" aria-label={heading}>
      <div className="net-head">
        <h4>{heading}</h4>
        {rows.length > 0 && <span className="muted small">{rows.length === 1 ? "1 person" : `${fmtNumber(rows.length)} people`}, best fit first</span>}
      </div>
      {rows.length > 0 && (
        <div className="net-tools">
          <button type="button" className="net-link" onClick={() => onPick([...new Set([...sel, ...pickable.slice(0, NET_FIRST).map((r) => r.contact_id)])])} disabled={pickable.length === 0}>
            Select top {Math.min(NET_FIRST, pickable.length) || NET_FIRST}
          </button>
          {n > 0 && <button type="button" className="net-link" onClick={() => onPick([])}>Clear</button>}
          <span className="net-hint muted small">Tick people, then draft them in one Claude chat.</span>
        </div>
      )}
      {error && !data ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <p className="net-empty muted small" role="status">Finding people in your network…</p>
      ) : rows.length === 0 ? (
        <p className="net-empty muted small">Nobody in your CRM fits this yet. Ask Claude to find people.</p>
      ) : (
        <ol className="net-list">
          {shown.map((r) => (
            <NetworkPerson
              key={r.contact_id}
              r={r}
              selected={selSet.has(r.contact_id)}
              sent={sentSet.has(r.contact_id)}
              onToggle={() => toggle(r.contact_id)}
              onNotNow={() => void notNow([r.contact_id])}
            />
          ))}
        </ol>
      )}
      {(rows.length > NET_FIRST || ds.length > 0) && (
        <div className="net-foot">
          {rows.length > NET_FIRST && (
            <button type="button" className="net-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
              {all ? "Show the top 5" : `See all ${fmtNumber(rows.length)}`}
            </button>
          )}
          {ds.length > 0 && (
            <button type="button" className="net-more" aria-expanded={showGone} onClick={() => setShowGone((v) => !v)}>
              Dismissed ({fmtNumber(ds.length)})
            </button>
          )}
        </div>
      )}
      {showGone && ds.length > 0 && <Dismissed ds={ds} known={known} onBack={(id) => void bringBack([id])} />}
      {n > 0 && (
        <div className="net-batch" role="region" aria-label="Selected people">
          <p className="net-batch-what">
            <b>{fmtNumber(n)} selected</b>
            <span>Priority {p.rank}, {ws.toLowerCase()}</span>
          </p>
          <div className="net-batch-acts">
            <button type="button" className="btn" onClick={() => void notNow(sel)}>Not now for {fmtNumber(n)}</button>
            <button type="button" className="btn primary" onClick={draft}><Icon.claude />Draft for {fmtNumber(n)} selected</button>
          </div>
        </div>
      )}
    </section>
  );
}

function NetworkPerson({ r, selected, sent, onToggle, onNotNow }: {
  r: NetworkRow;
  selected: boolean;
  sent: boolean;
  onToggle: () => void;
  onNotNow: () => void;
}) {
  const role = [r.title, r.company].filter(Boolean).join(", ");
  const li = safeHref(r.linkedin);
  const reasons = r.reasons ?? [];
  const w = scoreWidth(r.score);
  const name = r.name || "Unnamed contact";
  const id = `np-${r.contact_id}`;
  // The whole row ticks the box, except clicks on its own links and buttons.
  const rowClick = (e: MouseEvent<HTMLLIElement>) => {
    if (sent) return;
    if ((e.target as HTMLElement).closest("a, button, input, label")) return;
    onToggle();
  };
  return (
    <li className={`net-row${selected ? " is-picked" : ""}${sent ? " is-sent" : ""}`} onClick={rowClick}>
      <div className="net-pick">
        {sent ? (
          <span className="net-sent-mark" title="Sent to Claude"><Icon.check /></span>
        ) : (
          <label className="net-check">
            <input type="checkbox" checked={selected} onChange={onToggle} aria-labelledby={id} />
            <span aria-hidden><Icon.check /></span>
          </label>
        )}
      </div>
      <div className="net-who">
        <span className="net-name" id={id}>{name}</span>
        {role && <span className="net-role">{role}</span>}
        {sent && <span className="net-sent">Sent to Claude</span>}
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
        {li && (
          <a className="net-icon" href={li} target="_blank" rel="noopener noreferrer" aria-label={`LinkedIn: ${name}`} title="LinkedIn"><Icon.linkedin /></a>
        )}
        <Link className="net-icon" to={`/contacts?id=${r.contact_id}`} aria-label={`Contact: ${name}`} title="Contact"><Icon.contacts /></Link>
        <button type="button" className="net-icon net-x" onClick={onNotNow} aria-label={`Not now: ${name}`} title="Not now"><Icon.close /></button>
      </div>
    </li>
  );
}

/** People hidden with "Not now" for this priority, with when they come back and Bring back. */
function Dismissed({ ds, known, onBack }: {
  ds: Dismissal[];
  known: Map<string, NetworkRow>;
  onBack: (contactId: string) => void;
}) {
  const missing = ds.map((d) => d.contact_id).filter((id) => !known.has(id)).sort();
  const { data: names } = useLoad(() => contactNames(missing), `dn-${missing.join(",")}`);
  return (
    <ul className="net-gone" aria-label="Dismissed">
      {ds.map((d) => {
        const c = known.get(d.contact_id) ?? names?.get(d.contact_id);
        const role = [c?.title, c?.company].filter(Boolean).join(", ");
        const name = c?.name || "Contact";
        return (
          <li key={d.contact_id}>
            <div>
              <span className="net-gone-name">{name}</span>
              <span className="muted small">
                {[role, d.reason, d.until ? `back ${fmtDay(d.until)}` : "until you bring them back"].filter(Boolean).join(". ")}
              </span>
            </div>
            <button type="button" className="btn small ghost" onClick={() => onBack(d.contact_id)} aria-label={`Bring back ${name}`}>Bring back</button>
          </li>
        );
      })}
    </ul>
  );
}
