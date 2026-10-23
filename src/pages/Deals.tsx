import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { useLoad } from "../lib/useLoad.ts";
import { dealUpdate } from "../lib/data.ts";
import {
  appendNote, compareDeals, DEAL_HEATS, DEAL_LINES, DEAL_STAGES, fmtDay, GATE_FIELDS, GATE_VALUES, gateScore, isClosed, isOverdue,
  stageBlocker, ukToday, type DealGates,
} from "../lib/crm.ts";
import { isUuid } from "../lib/filters.ts";
import { fmtNumber } from "../lib/format.ts";
import { friendlyError } from "../lib/rules.ts";
import type { Deal } from "../lib/types.ts";
import { DEAL_COLS } from "../components/TodayCrm.tsx";
import { Empty, ErrorBox, Loading, useTitle } from "../components/ui.tsx";

async function loadDeals() {
  const [deals, contacts] = await Promise.all([
    supabase.from("deals").select(DEAL_COLS).limit(2000).then((r) => must(r) as unknown as Deal[]),
    supabase.from("crm_contacts").select("id,name,company").limit(5000)
      .then((r) => must(r) as unknown as { id: string; name: string | null; company: string | null }[]),
  ]);
  return { deals, contacts: new Map(contacts.map((c) => [c.id, c])) };
}

export default function Deals() {
  useTitle("Deals");
  const [sp, setSp] = useSearchParams();
  const openId = isUuid(sp.get("id")) ? sp.get("id") : null;
  const { data, error, loading, reload } = useLoad(loadDeals, "deals");
  const [showClosed, setShowClosed] = useState(false);
  const today = ukToday();

  const groups = useMemo(() => {
    const by = new Map<string, Deal[]>();
    for (const d of data?.deals ?? []) {
      if (!showClosed && isClosed(d.stage)) continue;
      const k = d.line || "Other";
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(d);
    }
    const order = [...DEAL_LINES] as string[];
    return [...by.entries()]
      .map(([line, ds]) => [line, ds.sort(compareDeals)] as const)
      .sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99));
  }, [data, showClosed]);

  const open = openId ? data?.deals.find((d) => d.id === openId) : undefined;
  const select = (id: string | null) => {
    const n = new URLSearchParams(sp);
    if (id) n.set("id", id);
    else n.delete("id");
    setSp(n);
  };
  const closedCount = (data?.deals ?? []).filter((d) => isClosed(d.stage)).length;

  return (
    <div className="stack-lg">
      <div className="section-head page-head-block">
        <span className="eyebrow">Pipeline</span>
        <h1>Deals</h1>
        <p className="muted">Grouped by line; hot first. Gates are principal verified, NCNDA, fee agreement, KYC and proof.</p>
      </div>
      {closedCount > 0 && (
        <label className="check">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          <span>Show closed deals ({fmtNumber(closedCount)})</span>
        </label>
      )}
      <div className={openId ? "split" : ""}>
        <div className="stack-lg">
          {error && !data ? (
            <ErrorBox error={error} onRetry={reload} />
          ) : loading && !data ? (
            <Loading />
          ) : groups.length === 0 ? (
            <Empty>No deals yet.</Empty>
          ) : (
            groups.map(([line, ds]) => (
              <section key={line} className="stack">
                <h2>{line} ({ds.length})</h2>
                <ul className="list">
                  {ds.map((d) => {
                    const who = d.contact_id ? data?.contacts.get(d.contact_id) : undefined;
                    return (
                      <li key={d.id} className={`list-item ${d.id === openId ? "row-selected" : ""}`}>
                        <div className="list-main">
                          <button type="button" className="row-link strong" onClick={() => select(d.id)}>{d.deal || d.counterparty || "(unnamed deal)"}</button>
                          <div className="meta">
                            {d.heat && <span className={`badge heat-${d.heat.toLowerCase()}`}>{d.heat}</span>}
                            {d.stage && <span className="badge">{d.stage}</span>}
                            <span className={`badge ${gateScore(d) === 5 ? "pill-good" : ""}`}>gates {gateScore(d)}/5</span>
                            {d.next_date && <span className={isOverdue(d.next_date, today) && !isClosed(d.stage) ? "error" : "muted"}>Next {fmtDay(d.next_date)}</span>}
                            {who && <Link to={`/contacts?id=${d.contact_id}`}>{who.name || who.company}</Link>}
                          </div>
                          {d.next_step && <p className="small">{d.next_step}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
        {openId && data && !open && (
          <div className="card stack">
            <h2>Deal not found</h2>
            <button className="btn small ghost" type="button" onClick={() => select(null)}>Close</button>
          </div>
        )}
        {open && <DealPanel key={`${open.id}-${open.updated_at}`} d={open} onClose={() => select(null)} onSaved={reload} />}
      </div>
    </div>
  );
}

function DealPanel({ d, onClose, onSaved }: { d: Deal; onClose: () => void; onSaved: () => void }) {
  const panelRef = usePanelScroll();
  const [gates, setGates] = useState<DealGates>({
    principal_verified: d.principal_verified, ncnda_signed: d.ncnda_signed, fee_signed: d.fee_signed, kyc_done: d.kyc_done, proof_done: d.proof_done,
  });
  const [stage, setStage] = useState(d.stage ?? "");
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const blocker = stage ? stageBlocker(stage, gates) : null;
  // Block a change of stage or gates that breaks the rule. A deal already sitting at a stage from the old CRM
  // can still have its next step, date and notes edited; the rule is shown as a note.
  const wasBlocked = d.stage ? stageBlocker(d.stage, d) !== null : false;
  const blocking = blocker && (stage !== (d.stage ?? "") || !wasBlocked) ? blocker : null;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (blocking) {
      setMsg({ ok: false, text: blocking });
      return;
    }
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "").trim();
    const patch: Record<string, unknown> = {
      heat: get("heat") || null,
      stage: stage || null,
      next_step: get("next_step") || null,
      next_date: get("next_date") || null,
      ...gates,
    };
    const notes = appendNote(d.notes, get("note"));
    if (notes !== null) patch.notes = notes;
    setPending(true);
    setMsg(null);
    try {
      await dealUpdate(d.id, patch);
      setMsg({ ok: true, text: "Saved." });
      onSaved();
    } catch (err) {
      setMsg({ ok: false, text: friendlyError(err) });
    } finally {
      setPending(false);
    }
  };

  return (
    <aside ref={panelRef} className="card stack detail-panel" aria-label="Deal details">
      <div className="row-between">
        <h2>{d.deal || d.counterparty || "(unnamed deal)"}</h2>
        <button className="btn small ghost" type="button" onClick={onClose}>Close</button>
      </div>
      <dl className="facts">
        <div><dt>Counterparty</dt><dd>{d.counterparty || "—"}</dd></div>
        <div><dt>Line</dt><dd>{d.line || "—"}</dd></div>
        <div><dt>Rank</dt><dd>{d.rank ?? "—"}</dd></div>
        <div><dt>Value</dt><dd>{d.value || "—"}</dd></div>
        {d.terms && <div><dt>Terms</dt><dd>{d.terms}</dd></div>}
      </dl>
      <form onSubmit={submit} className="stack">
        <div className="grid-2">
          <label className="field">
            <span>Heat</span>
            <select name="heat" defaultValue={d.heat ?? ""}>
              <option value="">—</option>
              {DEAL_HEATS.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Stage</span>
            <select value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="">—</option>
              {d.stage && !(DEAL_STAGES as readonly string[]).includes(d.stage) && <option value={d.stage}>{d.stage}</option>}
              {DEAL_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        {blocker && (
          <p className={blocking ? "warn small" : "muted small"} role={blocking ? "alert" : undefined}>
            {blocking ? blocker : `Note: ${blocker}`}
          </p>
        )}
        <fieldset className="field">
          <legend>Gates ({gateScore(gates)}/5)</legend>
          <div className="grid-2">
            {GATE_FIELDS.map((f) => (
              <label key={f.key} className="field">
                <span>{f.label}</span>
                <select value={gates[f.key] ?? ""} onChange={(e) => setGates((g) => ({ ...g, [f.key]: e.target.value || null }))}>
                  <option value="">—</option>
                  {GATE_VALUES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid-2">
          <label className="field">
            <span>Next date</span>
            <input type="date" name="next_date" defaultValue={d.next_date?.slice(0, 10) ?? ""} />
          </label>
        </div>
        <label className="field">
          <span>Next step</span>
          <textarea name="next_step" rows={2} defaultValue={d.next_step ?? ""} />
        </label>
        <label className="field">
          <span>Add a note</span>
          <small>Saved as a new dated line at the end. Earlier notes are never changed.</small>
          <textarea name="note" rows={2} />
        </label>
        {msg && <p className={msg.ok ? "ok" : "error"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
        <div className="action-row">
          <button className="btn primary" type="submit" disabled={pending || Boolean(blocking)}>{pending ? "Saving…" : "Save"}</button>
        </div>
      </form>
      <h3>Notes</h3>
      {d.notes ? <div className="crm-text">{d.notes}</div> : <p className="muted small">No notes yet.</p>}
    </aside>
  );
}

/** On phones the panel sits below the list, so bring it into view when it opens. */
function usePanelScroll() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (window.innerWidth < 900) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  return ref;
}
