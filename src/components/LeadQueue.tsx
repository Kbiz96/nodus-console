import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { fmtNumber, safeHref } from "../lib/format.ts";
import { scoreWidth, workstreamLabel } from "../lib/mandates.ts";
import { findMorePrompt, moveCursor, sourceLabel, writeOutboundPrompt, type Lead, type LeadStatus } from "../lib/leads.ts";
import { lineChip } from "../lib/brief.ts";
import type { Priority } from "../lib/types.ts";
import { AskClaude, openInClaude } from "./PriorityCard.tsx";
import { useHandoffs } from "./handoff.ts";
import { Icon } from "./Brand.tsx";
import { LeadEnrichDraft } from "./LeadEnrichDraft.tsx";

const FIRST = 6;

/**
 * New leads for one priority: people Claude scouted outside the CRM. Approve or dismiss each (or a ticked batch);
 * approved ones collect underneath and go to one Claude chat that enriches, drafts and sends on Kuran's "send".
 * Desktop keys: J and K move, A approves, X dismisses.
 */
export function LeadQueue({ p, fresh, approved, loading, onDecide, sent, onSent, find: findSlot, emptyText }: {
  /** The signed mandate, or null for Background BD leads from the engine. */
  p: Priority | null;
  /** Replaces "Find 50 more" (Background BD passes "Process 25 now"). */
  find?: ReactNode;
  emptyText?: string;
  fresh: Lead[];
  approved: Lead[];
  loading: boolean;
  onDecide: (leads: Lead[], status: LeadStatus) => void;
  sent: string[];
  onSent: (ids: string[]) => void;
}) {
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLOListElement>(null);
  const keyed = useRef(false);

  const shown = all ? fresh : fresh.slice(0, FIRST);
  const ids = new Set(fresh.map((r) => r.id));
  const sel = picked.filter((id) => ids.has(id));
  const selSet = new Set(sel);
  const n = sel.length;
  const scopeLabel = p ? `Priority ${p.rank}, ${workstreamLabel(p).toLowerCase()}` : "Background BD";
  const sentSet = new Set(sent);
  const toWrite = approved.filter((r) => !sentSet.has(r.id));
  const handoffs = useHandoffs();
  const find = !handoffs ? null : findSlot ?? (p ? (
    <AskClaude className="btn lead-find" prompt={findMorePrompt(p)}><Icon.claude />Find 50 more</AskClaude>
  ) : null);

  // After a key press, keep the focus on the row under the cursor (the next one once a row leaves).
  useEffect(() => {
    if (!keyed.current) return;
    const rows = listRef.current?.querySelectorAll<HTMLLIElement>(":scope > li");
    if (!rows || rows.length === 0) return;
    const i = Math.min(cursor, rows.length - 1);
    if (i !== cursor) setCursor(i);
    rows[i]?.focus();
  }, [cursor, shown.length]);

  const toggle = (id: string) => setPicked(selSet.has(id) ? sel.filter((x) => x !== id) : [...sel, id]);

  const act = (leads: Lead[], status: LeadStatus) => {
    if (leads.length === 0) return;
    setPicked(sel.filter((id) => !leads.some((l) => l.id === id)));
    onDecide(leads, status);
  };

  const onKey = (e: KeyboardEvent<HTMLOListElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const row = shown[Math.min(cursor, shown.length - 1)];
    if (k === "j" || k === "arrowdown") setCursor((c) => moveCursor(c, 1, shown.length));
    else if (k === "k" || k === "arrowup") setCursor((c) => moveCursor(c, -1, shown.length));
    else if (k === "a" && row) act([row], "approved");
    else if (k === "x" && row) act([row], "dismissed");
    else return;
    keyed.current = true;
    e.preventDefault();
    e.stopPropagation();
  };

  const write = () => {
    if (toWrite.length === 0) return;
    openInClaude(writeOutboundPrompt(toWrite, p));
    onSent(toWrite.map((r) => r.id));
  };

  return (
    <section className="leads" aria-label={p ? `New leads for priority ${p.rank}` : "Background BD leads"}>
      {fresh.length > 0 && (
        <div className="net-tools">
          <button type="button" className="net-link" onClick={() => setPicked([...new Set([...sel, ...fresh.slice(0, 5).map((r) => r.id)])])}>
            Select top {Math.min(5, fresh.length)}
          </button>
          {n > 0 && <button type="button" className="net-link" onClick={() => setPicked([])}>Clear</button>}
          <span className="lead-keys muted small" aria-hidden>
            <kbd>J</kbd><kbd>K</kbd> move, <kbd>A</kbd> approve, <kbd>X</kbd> dismiss
          </span>
          {find}
        </div>
      )}

      {loading && fresh.length === 0 && approved.length === 0 ? (
        <p className="net-empty muted small" role="status">Getting new leads…</p>
      ) : fresh.length === 0 ? (
        <div className="lead-empty">
          <p>{emptyText ?? "No new leads. Ask Claude to find more."}</p>
          {find}
        </div>
      ) : (
        <ol className="net-list lead-list" ref={listRef} onKeyDown={onKey} aria-label="New leads, best fit first">
          {shown.map((r, i) => (
            <LeadRow
              key={r.id}
              r={r}
              active={i === Math.min(cursor, shown.length - 1)}
              selected={selSet.has(r.id)}
              showLine={!p}
              onFocus={() => setCursor(i)}
              onToggle={() => toggle(r.id)}
              onApprove={() => act([r], "approved")}
              onDismiss={() => act([r], "dismissed")}
            />
          ))}
        </ol>
      )}

      {fresh.length > FIRST && (
        <div className="net-foot">
          <button type="button" className="net-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? `Show the top ${FIRST}` : `See all ${fmtNumber(fresh.length)}`}
          </button>
        </div>
      )}

      {approved.length > 0 && (
        <div className="lead-ok" role="region" aria-label={`Approved (${approved.length})`}>
          <div className="lead-ok-head">
            <h5>Approved ({fmtNumber(approved.length)})</h5>
            <span className="muted small">{toWrite.length > 0 ? (handoffs ? "Ready for outbound" : "Write their outbound on the Leads desk") : "With Claude. Drafts land in Review."}</span>
          </div>
          <ul className="lead-ok-list">
            {approved.map((r) => {
              const isSent = sentSet.has(r.id);
              return (
                <li key={r.id} className={isSent ? "is-sent" : undefined}>
                  <span className="lead-ok-name">{r.name}</span>
                  <span className="lead-ok-role">{[r.title, r.company].filter(Boolean).join(", ")}</span>
                  {isSent ? (
                    <span className="lead-sent">Sent to Claude</span>
                  ) : (
                    <button type="button" className="net-icon" onClick={() => onDecide([r], "new")} aria-label={`Move back to new leads: ${r.name}`} title="Move back to new leads">
                      <Icon.close />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {handoffs && toWrite.length > 0 && (
            <button type="button" className="btn primary big lead-write" onClick={write}>
              <Icon.claude />Write outbound for {fmtNumber(toWrite.length)}
            </button>
          )}
        </div>
      )}

      {n > 0 && (
        <div className="net-batch" role="region" aria-label="Selected leads">
          <p className="net-batch-what">
            <b>{fmtNumber(n)} selected</b>
            <span>{scopeLabel}</span>
          </p>
          <div className="net-batch-acts">
            <button type="button" className="btn" onClick={() => act(fresh.filter((r) => selSet.has(r.id)), "dismissed")}>Dismiss {fmtNumber(n)}</button>
            <button type="button" className="btn primary" onClick={() => act(fresh.filter((r) => selSet.has(r.id)), "approved")}><Icon.check />Approve {fmtNumber(n)}</button>
          </div>
        </div>
      )}
    </section>
  );
}

function LeadRow({ r, active, selected, showLine, onFocus, onToggle, onApprove, onDismiss }: {
  r: Lead;
  showLine: boolean;
  active: boolean;
  selected: boolean;
  onFocus: () => void;
  onToggle: () => void;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const role = [r.title, r.company].filter(Boolean).join(", ");
  const id = `lead-${r.id}`;
  const score = r.fit_score ?? 0;
  const hookHref = safeHref(r.hook_url);
  const li = safeHref(r.linkedin);
  const masked = r.name.includes("*");
  const rowClick = (e: MouseEvent<HTMLLIElement>) => {
    if ((e.target as HTMLElement).closest("a, button, input, label")) return;
    onToggle();
  };
  return (
    <li
      className={`lead-row${selected ? " is-picked" : ""}`}
      tabIndex={active ? 0 : -1}
      aria-labelledby={id}
      onFocus={onFocus}
      onClick={rowClick}
    >
      <div className="net-pick">
        <label className="net-check">
          <input type="checkbox" checked={selected} onChange={onToggle} aria-labelledby={id} tabIndex={-1} />
          <span aria-hidden><Icon.check /></span>
        </label>
      </div>
      <div className="lead-who">
        <span className="lead-name-line">
          <span className="net-name" id={id} title={masked ? "Full name after enrichment" : undefined}>{r.name}</span>
          {li && <a className="lead-li" href={li} target="_blank" rel="noopener noreferrer" aria-label={`LinkedIn: ${r.name}`} title="LinkedIn"><Icon.linkedin /></a>}
        </span>
        {role && <span className="net-role">{role}</span>}
      </div>
      <div className="lead-meta">
        {showLine && lineChip(r.line) ? (
          <span className={`lead-src lead-line ln-${r.line}`}>{lineChip(r.line)}</span>
        ) : (
          <span className={`lead-src src-${(r.source || "").toLowerCase()}`}>{sourceLabel(r.source)}</span>
        )}
        <span className="lead-score" title={`Fit score ${fmtNumber(score)}`} aria-label={`Fit score ${fmtNumber(score)}`}>
          <span className="net-bar" aria-hidden><span style={{ width: `${scoreWidth(score)}%` }} /></span>
          <span className="net-num">{fmtNumber(score)}</span>
        </span>
      </div>
      {r.fit_reason && <p className="lead-why">{r.fit_reason}</p>}
      {r.hook && (
        hookHref ? (
          <a className="lead-hook" href={hookHref} target="_blank" rel="noopener noreferrer">{r.hook}<Icon.external /></a>
        ) : (
          <p className="lead-hook">{r.hook}</p>
        )
      )}
      <div className="lead-acts">
        <LeadEnrichDraft r={r} about={r.hook || r.company || "this mandate"} />
        <button type="button" className="lead-yes" onClick={onApprove} aria-label={`Approve ${r.name}`} title="Approve (A)"><Icon.check /></button>
        <button type="button" className="lead-no" onClick={onDismiss} aria-label={`Dismiss ${r.name}`} title="Dismiss (X)"><Icon.close /></button>
      </div>
    </li>
  );
}
