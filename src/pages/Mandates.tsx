import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { mandateSave } from "../lib/data.ts";
import { criteriaSummary, isUuid } from "../lib/filters.ts";
import { useLoad } from "../lib/useLoad.ts";
import { fmtDate } from "../lib/format.ts";
import { lineLabel, SIDE_LABEL } from "../lib/labels.ts";
import { friendlyError } from "../lib/rules.ts";
import MandateForm from "../components/MandateForm.tsx";
import MandateCardEdit, { ConfidenceBadge } from "../components/MandateCardEdit.tsx";
import { MANDATE_KINDS, MANDATE_KIND_LABEL } from "../lib/crm.ts";
import { Empty, ErrorBox, LineBadge, Loading, useTitle } from "../components/ui.tsx";

interface MandateRow {
  id: string;
  label: string;
  line: string;
  side: string;
  criteria: Record<string, unknown> | null;
  capital_circle: boolean;
  active: boolean;
  created_at: string;
  kind: string | null;
  holder: string | null;
  confidence: string | null;
  to_ask: string | null;
  card: Record<string, unknown> | null;
  matches: { count: number }[];
}

async function load() {
  return must(
    await supabase
      .from("mandates")
      .select("id,label,line,side,criteria,capital_circle,active,created_at,kind,holder,confidence,to_ask,card,matches(count)")
      .order("active", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500),
  ) as unknown as MandateRow[];
}

export default function Mandates() {
  useTitle("Mandates");
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const editId = isUuid(sp.get("edit")) ? sp.get("edit") : null;
  const { data, error, loading, reload } = useLoad(load, "mandates");
  const [saved, setSaved] = useState<string | null>(null);
  const [toggleMsg, setToggleMsg] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const editing = editId ? data?.find((m) => m.id === editId) : undefined;
  const kindRaw = sp.get("kind");
  const kind = kindRaw && (kindRaw === "none" || (MANDATE_KINDS as readonly string[]).includes(kindRaw)) ? kindRaw : null;
  const shown = (data ?? []).filter((m) => !kind || (kind === "none" ? !m.kind : m.kind === kind));
  const kindCount = (k: string | null) => (data ?? []).filter((m) => (k === "none" ? !m.kind : !k || m.kind === k)).length;

  const toggle = async (m: MandateRow) => {
    setBusy(m.id);
    setToggleMsg(null);
    try {
      await mandateSave({
        id: m.id, label: m.label, line: m.line, side: m.side, criteria: m.criteria ?? {},
        capitalCircle: m.capital_circle, active: !m.active,
      });
      reload();
    } catch (e) {
      setToggleMsg({ id: m.id, text: friendlyError(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack-lg">
      <div className="section-head">
        <h1>Mandates</h1>
        <p className="muted">
          Standing requirements from your network. Every morning the engine checks new opportunities against each active
          mandate and proposes matches.
        </p>
      </div>
      {saved && <p className="ok" role="status">{saved}</p>}

      <div className="split">
        <section className="stack">
          <h2>Your mandates</h2>
          {data && data.length > 0 && (
            <nav className="tabs" aria-label="Kind">
              <Link to="/mandates" className={!kind ? "active" : undefined}>All ({kindCount(null)})</Link>
              {MANDATE_KINDS.map((k) => (
                <Link key={k} to={`/mandates?kind=${k}`} className={kind === k ? "active" : undefined}>{MANDATE_KIND_LABEL[k]} ({kindCount(k)})</Link>
              ))}
              {kindCount("none") > 0 && <Link to="/mandates?kind=none" className={kind === "none" ? "active" : undefined}>No kind ({kindCount("none")})</Link>}
            </nav>
          )}
          {error && !data ? (
            <ErrorBox error={error} onRetry={reload} />
          ) : loading && !data ? (
            <Loading />
          ) : !data || data.length === 0 ? (
            <Empty>No mandates yet. Add your first one using the form.</Empty>
          ) : shown.length === 0 ? (
            <Empty>No mandates of this kind.</Empty>
          ) : (
            <ul className="list">
              {shown.map((m) => (
                <li key={m.id} className={`list-item card ${m.active ? "" : "inactive"}`}>
                  <div className="list-main">
                    <div className="row-between">
                      <strong>{m.label}</strong>
                      {!m.active && <span className="badge">Switched off</span>}
                    </div>
                    <div className="meta">
                      {m.kind && <span className="badge">{MANDATE_KIND_LABEL[m.kind] ?? m.kind}</span>}
                      <ConfidenceBadge value={m.confidence} />
                      <LineBadge line={m.line} />
                      <span className="badge">{SIDE_LABEL[m.side]}</span>
                      {m.capital_circle && <span className="badge circle">Capital Circle</span>}
                      <span className="muted">Added {fmtDate(m.created_at)}</span>
                      <Link to={`/matches?q=${encodeURIComponent(m.label)}`}>{m.matches?.[0]?.count ?? 0} matches</Link>
                    </div>
                    <ul className="small muted plain">
                      {criteriaSummary(m.criteria ?? {}, lineLabel).map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                    <div className="action-row">
                      <Link className="btn small" to={`/mandates?edit=${m.id}`}>Edit</Link>
                      <button className="btn small ghost" type="button" disabled={busy === m.id} onClick={() => toggle(m)}>
                        {m.active ? "Switch off" : "Switch back on"}
                      </button>
                    </div>
                    {toggleMsg?.id === m.id && <p className="error small" role="alert">{toggleMsg.text}</p>}
                    <MandateCardEdit key={`${m.id}-${JSON.stringify(m.card)}-${m.confidence}-${m.kind}`} m={m} onSaved={reload} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        {editId && !editing && data ? (
          <div className="card stack">
            <h2>Mandate not found</h2>
            <p className="muted">It may have been removed.</p>
            <Link to="/mandates">Add a new mandate instead</Link>
          </div>
        ) : editId && !editing ? (
          <Loading />
        ) : (
          <MandateForm
            key={editing?.id ?? "new"}
            initial={editing ?? {}}
            onSaved={() => {
              setSaved("Saved. The engine will use it on its next run.");
              reload();
              if (editId) navigate("/mandates");
            }}
          />
        )}
      </div>
    </div>
  );
}
