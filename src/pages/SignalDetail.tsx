import { Link, useParams } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { isUuid } from "../lib/filters.ts";
import { useLoad } from "../lib/useLoad.ts";
import { fmtDate, fmtDateTime } from "../lib/format.ts";
import { Confidence, ErrorBox, ExtLink, GateBadge, LineBadge, Loading, NotFound, SanctionsBadge, useTitle } from "../components/ui.tsx";

interface Sig {
  id: string; title: string; quote: string | null; source_url: string; confidence: number; retrieved_at: string;
  event_date: string | null; line: string | null; signal_type: string; extracted: boolean;
  sources: { name: string } | null;
  opportunity_signals: { opportunities: { id: string; title: string; gate: string } | null }[];
  signal_entities: { role: string | null; organisations: { id: string; legal_name: string; sanctions_status: string } | null }[];
}

export default function SignalDetail() {
  const { id = "" } = useParams();
  const { data, error, loading, reload } = useLoad(async () => {
    if (!isUuid(id)) return null;
    return must(
      await supabase
        .from("signals")
        .select(
          "id,title,quote,source_url,confidence,retrieved_at,event_date,line,signal_type,extracted,sources(name),opportunity_signals(opportunities(id,title,gate)),signal_entities(role,organisations(id,legal_name,sanctions_status))",
        )
        .eq("id", id)
        .maybeSingle(),
    ) as unknown as Sig | null;
  }, id);
  useTitle(data?.title ?? "Signal");
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return <NotFound what="signal" />;
  const s = data;
  const opps = (s.opportunity_signals ?? []).map((x) => x.opportunities).filter((o): o is NonNullable<typeof o> => Boolean(o));
  const seen = new Set<string>();
  const orgs = (s.signal_entities ?? []).filter((e) => e.organisations && !seen.has(e.organisations.id) && seen.add(e.organisations.id));
  return (
    <div className="stack-lg">
      <p><Link to="/signals">← All signals</Link></p>
      <section className="card stack">
        <div className="meta">
          <LineBadge line={s.line} />
          <span className="badge">{s.signal_type.replace(/_/g, " ")}</span>
          <Confidence value={s.confidence} />
        </div>
        <h1>{s.title}</h1>
        {s.quote && <blockquote>{s.quote}</blockquote>}
        <dl className="facts">
          <div><dt>Source</dt><dd>{s.sources?.name ?? "—"}</dd></div>
          <div><dt>Link</dt><dd><ExtLink url={s.source_url}>Open the original</ExtLink></dd></div>
          <div><dt>Retrieved</dt><dd>{fmtDateTime(s.retrieved_at)}</dd></div>
          <div><dt>Event date</dt><dd>{fmtDate(s.event_date)}</dd></div>
          <div><dt>Read by</dt><dd>{s.extracted ? "AI (from the quote above)" : "The engine directly"}</dd></div>
        </dl>
      </section>
      <section className="stack">
        <h2>Opportunities</h2>
        {opps.length === 0 ? <p className="muted">Not linked to an opportunity.</p> : (
          <ul className="list">
            {opps.map((o) => (
              <li key={o.id} className="list-item"><Link to={`/opportunities/${o.id}`}>{o.title}</Link> <GateBadge gate={o.gate} /></li>
            ))}
          </ul>
        )}
      </section>
      {orgs.length > 0 && (
        <section className="stack">
          <h2>Organisations mentioned</h2>
          <ul className="list">
            {orgs.map(({ role, organisations: g }) => (
              <li key={g!.id} className="list-item">
                <Link to={`/organisations/${g!.id}`}>{g!.legal_name}</Link> {role && <span className="muted">({role})</span>}{" "}
                <SanctionsBadge status={g!.sanctions_status} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
