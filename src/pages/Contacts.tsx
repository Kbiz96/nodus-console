import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { useLoad } from "../lib/useLoad.ts";
import { contactUpdate } from "../lib/data.ts";
import { appendNote, CONTACT_LINES, CONTACT_STAGES, fmtDay, gateScore, isDue, isOverdue, ukToday } from "../lib/crm.ts";
import { isUuid } from "../lib/filters.ts";
import { fmtNumber } from "../lib/format.ts";
import { friendlyError } from "../lib/rules.ts";
import type { CrmContact, Deal, Outreach } from "../lib/types.ts";
import { DEAL_COLS, OUTREACH_COLS } from "../components/TodayCrm.tsx";
import { OutreachLine } from "../components/OutreachCards.tsx";
import { Empty, ErrorBox, ExtLink, Loading, useTitle } from "../components/ui.tsx";

const CONTACT_COLS =
  "id,name,title,company,email,linkedin,country,lines,side,category,stage,priority,channel,source,signal,first_contact,last_activity,next_follow_up,do_not_contact,notes,updated_at";
const PRIORITIES = ["High", "Medium", "Low"];

async function loadContacts() {
  return must(
    await supabase.from("crm_contacts").select(CONTACT_COLS).order("next_follow_up", { ascending: true, nullsFirst: false }).order("name").limit(5000),
  ) as unknown as CrmContact[];
}

export default function Contacts() {
  useTitle("Contacts");
  const [sp, setSp] = useSearchParams();
  const openId = isUuid(sp.get("id")) ? sp.get("id") : null;
  const { data, error, loading, reload } = useLoad(loadContacts, "contacts");
  const [q, setQ] = useState("");
  const [line, setLine] = useState("");
  const [stage, setStage] = useState("");
  const [priority, setPriority] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const today = ukToday();

  const priorities = useMemo(() => {
    const s = new Set(PRIORITIES);
    for (const c of data ?? []) if (c.priority) s.add(c.priority);
    return [...s];
  }, [data]);

  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (data ?? []).filter((c) => {
      if (line && !(c.lines ?? []).includes(line)) return false;
      if (stage && c.stage !== stage) return false;
      if (priority && c.priority !== priority) return false;
      if (dueOnly && !isDue(c.next_follow_up, today)) return false;
      if (words.length) {
        const hay = [c.name, c.company, c.title, c.email, c.country, c.category, c.notes].join(" ").toLowerCase();
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
  }, [data, q, line, stage, priority, dueOnly, today]);

  const open = openId ? data?.find((c) => c.id === openId) : undefined;
  const select = (id: string | null) => {
    const n = new URLSearchParams(sp);
    if (id) n.set("id", id);
    else n.delete("id");
    setSp(n);
  };

  return (
    <div className="stack-lg">
      <div className="section-head">
        <h1>Contacts</h1>
        <p className="muted">Everyone in the Nodus CRM. Tap a name to update their stage, follow-up date or notes.</p>
      </div>

      <form className="filters" onSubmit={(e) => e.preventDefault()}>
        <label className="field grow">
          <span>Search</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, company, email, notes" />
        </label>
        <label className="field">
          <span>Line</span>
          <select value={line} onChange={(e) => setLine(e.target.value)}>
            <option value="">All lines</option>
            {CONTACT_LINES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Stage</span>
          <select value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">Any stage</option>
            {CONTACT_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Priority</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">Any priority</option>
            {priorities.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} />
          <span>Follow-up due</span>
        </label>
      </form>

      <div className={open || openId ? "split" : ""}>
        <section className="stack">
          {error && !data ? (
            <ErrorBox error={error} onRetry={reload} />
          ) : loading && !data ? (
            <Loading />
          ) : rows.length === 0 ? (
            <Empty>{data?.length ? "No contacts match these filters." : "No contacts yet."}</Empty>
          ) : (
            <>
              <p className="muted small">{fmtNumber(rows.length)} of {fmtNumber(data?.length ?? 0)} contacts</p>
              <div className="table-wrap">
                <table className="table stack-sm">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Company</th>
                      <th>Stage</th>
                      <th>Priority</th>
                      <th>Follow-up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 500).map((c) => (
                      <tr key={c.id} className={c.id === openId ? "row-selected" : undefined}>
                        <td className="title-cell">
                          <button type="button" className="row-link" onClick={() => select(c.id)}>{c.name || "(no name)"}</button>
                          {c.do_not_contact && <span className="badge pill-bad"> Do not contact</span>}
                          {c.title && <div className="muted small">{c.title}</div>}
                        </td>
                        <td data-label="Company">{c.company || "—"}</td>
                        <td data-label="Stage">{c.stage || "—"}</td>
                        <td data-label="Priority">{c.priority || "—"}</td>
                        <td data-label="Follow-up" className={isOverdue(c.next_follow_up, today) ? "error" : undefined}>{fmtDay(c.next_follow_up)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 500 && <p className="muted small">Showing the first 500. Narrow the search to see the rest.</p>}
            </>
          )}
        </section>
        {openId && data && !open && (
          <div className="card stack">
            <h2>Contact not found</h2>
            <button className="btn small ghost" type="button" onClick={() => select(null)}>Close</button>
          </div>
        )}
        {open && <ContactPanel key={`${open.id}-${open.updated_at}`} c={open} onClose={() => select(null)} onSaved={reload} />}
      </div>
    </div>
  );
}

async function loadHistory(id: string) {
  const [outreach, deals] = await Promise.all([
    supabase.from("outreach").select(OUTREACH_COLS).eq("contact_id", id).order("created_at", { ascending: false }).limit(100)
      .then((r) => must(r) as unknown as Outreach[]),
    supabase.from("deals").select(DEAL_COLS).eq("contact_id", id).order("updated_at", { ascending: false }).limit(50)
      .then((r) => must(r) as unknown as Deal[]),
  ]);
  return { outreach, deals };
}

function ContactPanel({ c, onClose, onSaved }: { c: CrmContact; onClose: () => void; onSaved: () => void }) {
  const panelRef = usePanelScroll();
  const hist = useLoad(() => loadHistory(c.id), `contact-${c.id}`);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const extraLines = (c.lines ?? []).filter((l) => !(CONTACT_LINES as readonly string[]).includes(l));

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "").trim();
    const patch: Record<string, unknown> = {
      stage: get("stage") || null,
      priority: get("priority") || null,
      next_follow_up: get("next_follow_up") || null,
      lines: fd.getAll("lines").map(String),
      do_not_contact: fd.get("do_not_contact") === "on",
    };
    const notes = appendNote(c.notes, get("note"));
    if (notes !== null) {
      patch.notes = notes;
      patch.last_activity = ukToday();
    }
    setPending(true);
    setMsg(null);
    try {
      await contactUpdate(c.id, patch);
      setMsg({ ok: true, text: "Saved." });
      onSaved();
    } catch (err) {
      setMsg({ ok: false, text: friendlyError(err) });
    } finally {
      setPending(false);
    }
  };

  return (
    <aside ref={panelRef} className="card stack detail-panel" aria-label="Contact details">
      <div className="row-between">
        <h2>{c.name || "(no name)"}</h2>
        <button className="btn small ghost" type="button" onClick={onClose}>Close</button>
      </div>
      <dl className="facts">
        <div><dt>Title</dt><dd>{c.title || "—"}</dd></div>
        <div><dt>Company</dt><dd>{c.company || "—"}</dd></div>
        <div><dt>Email</dt><dd>{c.email || "—"}</dd></div>
        <div><dt>LinkedIn</dt><dd>{c.linkedin ? <ExtLink url={c.linkedin}>Open profile</ExtLink> : "—"}</dd></div>
        <div><dt>Country</dt><dd>{c.country || "—"}</dd></div>
        <div><dt>Category / side</dt><dd>{[c.category, c.side].filter(Boolean).join(" · ") || "—"}</dd></div>
        <div><dt>Channel / source</dt><dd>{[c.channel, c.source].filter(Boolean).join(" · ") || "—"}</dd></div>
        <div><dt>First contact</dt><dd>{fmtDay(c.first_contact)}</dd></div>
        <div><dt>Last activity</dt><dd>{fmtDay(c.last_activity)}</dd></div>
      </dl>
      {c.signal && <p className="small"><span className="muted">Signal:</span> {c.signal}</p>}

      <form onSubmit={submit} className="stack">
        <div className="grid-2">
          <label className="field">
            <span>Stage</span>
            <select name="stage" defaultValue={c.stage ?? ""}>
              <option value="">—</option>
              {c.stage && !(CONTACT_STAGES as readonly string[]).includes(c.stage) && <option value={c.stage}>{c.stage}</option>}
              {CONTACT_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Priority</span>
            <select name="priority" defaultValue={c.priority ?? ""}>
              <option value="">—</option>
              {c.priority && !PRIORITIES.includes(c.priority) && <option value={c.priority}>{c.priority}</option>}
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Next follow-up</span>
            <input type="date" name="next_follow_up" defaultValue={c.next_follow_up?.slice(0, 10) ?? ""} />
          </label>
        </div>
        <fieldset className="field">
          <legend>Lines</legend>
          <div className="checks">
            {[...CONTACT_LINES, ...extraLines].map((l) => (
              <label key={l} className="check">
                <input type="checkbox" name="lines" value={l} defaultChecked={(c.lines ?? []).includes(l)} />
                <span>{l}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="check">
          <input type="checkbox" name="do_not_contact" defaultChecked={Boolean(c.do_not_contact)} />
          <span>Do not contact</span>
        </label>
        <label className="field">
          <span>Add a note</span>
          <small>Saved as a new dated line at the end. Earlier notes are never changed.</small>
          <textarea name="note" rows={2} />
        </label>
        {msg && <p className={msg.ok ? "ok" : "error"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
        <div className="action-row">
          <button className="btn primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        </div>
      </form>

      <h3>Notes</h3>
      {c.notes ? <div className="crm-text">{c.notes}</div> : <p className="muted small">No notes yet.</p>}

      <h3>Deals</h3>
      {hist.error && !hist.data ? (
        <ErrorBox error={hist.error} onRetry={hist.reload} />
      ) : !hist.data ? (
        <Loading />
      ) : hist.data.deals.length === 0 ? (
        <p className="muted small">No deals.</p>
      ) : (
        <ul className="list">
          {hist.data.deals.map((d) => (
            <li key={d.id} className="list-item">
              <div className="list-main">
                <Link to={`/deals?id=${d.id}`}>{d.deal || d.counterparty || "(unnamed deal)"}</Link>
                <div className="meta">
                  {d.stage && <span className="badge">{d.stage}</span>}
                  <span className="muted">gates {gateScore(d)}/5</span>
                  {d.next_date && <span className="muted">Next {fmtDay(d.next_date)}</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3>Outreach</h3>
      {hist.data && (hist.data.outreach.length === 0 ? <p className="muted small">No outreach yet.</p> : (
        <ul className="list">{hist.data.outreach.map((o) => <OutreachLine key={o.id} o={o} />)}</ul>
      ))}
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
