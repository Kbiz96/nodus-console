import { Link, useParams } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { isUuid } from "../lib/filters.ts";
import { useLoad } from "../lib/useLoad.ts";
import { fmtDate, fmtDateTime, fmtMW, fmtNumber, reference } from "../lib/format.ts";
import { GATE_HINT, GATE_LABEL, LINE_LABEL, SIDE_HINT, SIDE_LABEL } from "../lib/labels.ts";
import { GATE_ORDER, gateBlocker, gateIndex, nextGate } from "../lib/rules.ts";
import GateControl from "../components/GateControl.tsx";
import { Confidence, Empty, ErrorBox, ExtLink, GateBadge, LineBadge, Loading, NotFound, SanctionsBadge, useTitle } from "../components/ui.tsx";

interface Opp {
  id: string;
  line: string;
  side: string;
  title: string;
  specs: Record<string, unknown> | null;
  country: string | null;
  region: string | null;
  timing_from: string | null;
  timing_to: string | null;
  price_indicator: string | null;
  credibility: number;
  red_flags: string[] | null;
  gate: string;
  source_kind: string;
  created_at: string;
  updated_at: string;
  organisation_id: string | null;
  organisations: { id: string; legal_name: string; country: string | null; sanctions_status: string; screened_at: string | null } | null;
}
interface SigLink {
  signals: {
    id: string; title: string; quote: string | null; source_url: string; confidence: number; retrieved_at: string;
    sources: { name: string } | null;
  } | null;
}

const SPEC_LABELS: Record<string, string> = {
  mw: "Capacity",
  frequency_hz: "Grid frequency",
  technology: "Technology",
  data_centre: "Data-centre related",
  stage: "Stage",
  amount: "Amount",
  chain_of_title: "Chain of title",
  sources: "Sources",
  signal_types: "Signal types",
};

function specValue(k: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (k === "mw") return fmtMW(v);
  if (k === "frequency_hz") return `${v} Hz`;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return fmtNumber(v, 2);
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

async function load(id: string) {
  if (!isUuid(id)) return null;
  const o = must(
    await supabase
      .from("opportunities")
      .select(
        "id,line,side,title,specs,country,region,timing_from,timing_to,price_indicator,credibility,red_flags,gate,source_kind,created_at,updated_at,organisation_id,organisations(id,legal_name,country,sanctions_status,screened_at)",
      )
      .eq("id", id)
      .maybeSingle(),
  ) as unknown as Opp | null;
  if (!o) return null;
  const [links, matches, history] = await Promise.all([
    supabase
      .from("opportunity_signals")
      .select("signals(id,title,quote,source_url,confidence,retrieved_at,sources(name))")
      .eq("opportunity_id", id)
      .then((r) => must(r) as unknown as SigLink[]),
    supabase
      .from("matches")
      .select("id,thesis,total_score,status")
      .or(`supply_opportunity_id.eq.${id},need_opportunity_id.eq.${id},bundle_opportunity_ids.cs.{${id}}`)
      .order("total_score", { ascending: false })
      .limit(20)
      .then((r) => must(r) as { id: string; thesis: string | null; total_score: number; status: string }[]),
    supabase
      .from("audit_log")
      .select("at,actor,detail")
      .eq("action", "gate_change")
      .eq("entity_table", "opportunities")
      .eq("entity_id", id)
      .order("at", { ascending: false })
      .limit(20)
      .then((r) => must(r) as { at: string; actor: string; detail: Record<string, unknown> | null }[]),
  ]);
  const signals = links
    .map((l) => l.signals)
    .filter((s): s is NonNullable<SigLink["signals"]> => Boolean(s))
    .sort((a, b) => +new Date(b.retrieved_at) - +new Date(a.retrieved_at));
  return { o, signals, matches, history };
}

export default function OpportunityDetail() {
  const { id = "" } = useParams();
  const { data, error, loading, reload } = useLoad(() => load(id), id);
  useTitle(data?.o.title ?? "Opportunity");
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return <NotFound what="opportunity" />;
  const { o, signals, matches, history } = data;
  const org = o.organisations;
  const next = nextGate(o.gate);
  const blocker = next
    ? gateBlocker({ line: o.line, side: o.side, specs: o.specs, gate: o.gate, orgSanctions: org ? org.sanctions_status : null })
    : null;
  const specs = Object.entries(o.specs ?? {});
  const flags = o.red_flags ?? [];

  return (
    <div className="stack-lg">
      <p><Link to={`/opportunities?line=${o.line}`}>← {LINE_LABEL[o.line]} opportunities</Link></p>
      <section className="card stack">
        <div className="meta">
          <LineBadge line={o.line} />
          <span className="badge">{SIDE_LABEL[o.side]} — {SIDE_HINT[o.side]}</span>
          <GateBadge gate={o.gate} />
        </div>
        <h1>{o.title}</h1>
        <dl className="facts">
          <div><dt>Where</dt><dd>{[o.region, o.country].filter(Boolean).join(", ") || "—"}</dd></div>
          <div><dt>Timing</dt><dd>{o.timing_from || o.timing_to ? `${fmtDate(o.timing_from)} to ${fmtDate(o.timing_to, "open")}` : "Not stated"}</dd></div>
          <div><dt>Credibility</dt><dd>{fmtNumber(o.credibility)} / 100</dd></div>
          <div><dt>Price indication</dt><dd>{o.price_indicator || "—"}</dd></div>
          <div><dt>Found through</dt><dd>{o.source_kind === "network" ? "Your network" : "Public sources"}</dd></div>
          <div><dt>First found</dt><dd>{fmtDateTime(o.created_at)}</dd></div>
          <div><dt>Last updated</dt><dd>{fmtDateTime(o.updated_at)}</dd></div>
          <div><dt>Reference</dt><dd>{reference(o.id)}</dd></div>
        </dl>
        {flags.length > 0 && (
          <div className="warn">
            <strong>Red flags:</strong>
            <ul>{flags.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
        )}
        {specs.length > 0 && (
          <>
            <h2>Details</h2>
            <dl className="facts">
              {specs.map(([k, v]) => (
                <div key={k}><dt>{SPEC_LABELS[k] ?? k.replace(/_/g, " ")}</dt><dd>{specValue(k, v)}</dd></div>
              ))}
            </dl>
          </>
        )}
      </section>

      <section className="card stack">
        <h2>Step</h2>
        <ol className="gate-steps">
          {GATE_ORDER.map((g) => (
            <li key={g} className={g === o.gate ? "current" : gateIndex(g) < gateIndex(o.gate) ? "done" : ""}>
              <strong>{GATE_LABEL[g]}</strong>
              <span className="muted small">{GATE_HINT[g]}</span>
            </li>
          ))}
        </ol>
        {next ? (
          <GateControl key={o.gate} id={o.id} current={o.gate} next={next} blocker={blocker} onMoved={reload} />
        ) : (
          <p className="muted">This opportunity has reached the final step.</p>
        )}
        {history.length > 0 && (
          <details>
            <summary>History ({history.length})</summary>
            <ul className="list">
              {history.map((h, i) => (
                <li key={i} className="list-item">
                  {fmtDateTime(h.at)} — {GATE_LABEL[String(h.detail?.old)] ?? String(h.detail?.old)} →{" "}
                  {GATE_LABEL[String(h.detail?.new)] ?? String(h.detail?.new)}
                  {h.detail?.reason ? <span className="muted"> ({String(h.detail.reason)})</span> : null}
                  <span className="muted"> by {h.actor}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="card stack">
        <h2>Organisation</h2>
        {org ? (
          <dl className="facts">
            <div><dt>Name</dt><dd><Link to={`/organisations/${org.id}`}>{org.legal_name}</Link></dd></div>
            <div><dt>Country</dt><dd>{org.country || "—"}</dd></div>
            <div><dt>Sanctions check</dt><dd><SanctionsBadge status={org.sanctions_status ?? "unscreened"} /></dd></div>
            <div><dt>Last checked</dt><dd>{fmtDateTime(org.screened_at, "Never")}</dd></div>
          </dl>
        ) : (
          <p className="muted">No organisation linked yet.</p>
        )}
      </section>

      <section className="stack">
        <h2>Evidence ({signals.length})</h2>
        {signals.length === 0 ? (
          <Empty>No signals linked.</Empty>
        ) : (
          <ul className="list">
            {signals.map((s) => (
              <li key={s.id} className="list-item">
                <div className="list-main">
                  <Link to={`/signals/${s.id}`}>{s.title}</Link>
                  {s.quote && <blockquote>{s.quote}</blockquote>}
                  <div className="meta">
                    <Confidence value={s.confidence} />
                    <span className="muted">{s.sources?.name}</span>
                    <span className="muted">Retrieved {fmtDateTime(s.retrieved_at)}</span>
                    <ExtLink url={s.source_url}>Open source</ExtLink>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {matches.length > 0 && (
        <section className="stack">
          <h2>Matches involving this</h2>
          <ul className="list">
            {matches.map((m) => (
              <li key={m.id} className="list-item">
                <Link to={`/matches/${m.id}`}>{m.thesis || "Match"}</Link> <span className="muted">· score {Math.round(m.total_score)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
