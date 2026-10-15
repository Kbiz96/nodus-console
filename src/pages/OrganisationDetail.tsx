import { Link, useParams } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { isUuid } from "../lib/filters.ts";
import { useLoad } from "../lib/useLoad.ts";
import { fmtDateTime, fmtMW } from "../lib/format.ts";
import { SANCTIONS_LABEL, SIDE_LABEL } from "../lib/labels.ts";
import { Confidence, Empty, ErrorBox, ExtLink, GateBadge, LineBadge, Loading, NotFound, SanctionsBadge, useTitle } from "../components/ui.tsx";

interface Org {
  id: string; legal_name: string; aliases: string[] | null; country: string | null; org_type: string | null;
  website_domain: string | null; companies_house_no: string | null; sec_cik: string | null; lei: string | null;
  sanctions_status: string; screened_at: string | null; source_url: string; retrieved_at: string;
}
interface Sig { id: string; title: string; quote: string | null; source_url: string; confidence: number; retrieved_at: string; line: string | null }
const SIG_COLS = "id,title,quote,source_url,confidence,retrieved_at,line";

async function load(id: string) {
  if (!isUuid(id)) return null;
  const g = must(
    await supabase
      .from("organisations")
      .select("id,legal_name,aliases,country,org_type,website_domain,companies_house_no,sec_cik,lei,sanctions_status,screened_at,source_url,retrieved_at")
      .eq("id", id)
      .maybeSingle(),
  ) as Org | null;
  if (!g) return null;
  const [opps, mentioned, screening] = await Promise.all([
    supabase
      .from("opportunities")
      .select(`id,title,line,side,gate,specs,opportunity_signals(signals(${SIG_COLS}))`)
      .eq("organisation_id", id)
      .order("created_at", { ascending: false })
      .limit(100)
      .then((r) => must(r) as unknown as { id: string; title: string; line: string; side: string; gate: string; specs: Record<string, unknown> | null; opportunity_signals: { signals: Sig | null }[] }[]),
    supabase
      .from("signal_entities")
      .select(`role,signals(${SIG_COLS})`)
      .eq("organisation_id", id)
      .limit(100)
      .then((r) => must(r) as unknown as { role: string | null; signals: Sig | null }[]),
    supabase
      .from("screening_results")
      .select("status,lists_checked,screened_at,hits")
      .eq("organisation_id", id)
      .order("screened_at", { ascending: false })
      .limit(1)
      .then((r) => must(r) as { status: string; lists_checked: string[] | null; screened_at: string; hits: unknown[] | null }[]),
  ]);
  const byId = new Map<string, Sig>();
  for (const m of mentioned) if (m.signals) byId.set(m.signals.id, m.signals);
  for (const o of opps) for (const l of o.opportunity_signals ?? []) if (l.signals) byId.set(l.signals.id, l.signals);
  const signals = [...byId.values()].sort((a, b) => +new Date(b.retrieved_at) - +new Date(a.retrieved_at)).slice(0, 100);
  return { g, opps, signals, screening: screening[0] ?? null };
}

export default function OrganisationDetail() {
  const { id = "" } = useParams();
  const { data, error, loading, reload } = useLoad(() => load(id), id);
  useTitle(data?.g.legal_name ?? "Organisation");
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return <NotFound what="organisation" />;
  const { g, opps, signals, screening } = data;
  return (
    <div className="stack-lg">
      <section className="card stack">
        <h1>{g.legal_name}</h1>
        <div className="meta"><SanctionsBadge status={g.sanctions_status} /></div>
        <dl className="facts">
          <div><dt>Also known as</dt><dd>{g.aliases?.length ? g.aliases.join(", ") : "—"}</dd></div>
          <div><dt>Country</dt><dd>{g.country || "—"}</dd></div>
          <div><dt>Type</dt><dd>{g.org_type ? g.org_type.replace(/_/g, " ") : "—"}</dd></div>
          <div><dt>Website</dt><dd>{g.website_domain ? <ExtLink url={`https://${g.website_domain}`}>{g.website_domain}</ExtLink> : "—"}</dd></div>
          {g.companies_house_no && <div><dt>Companies House</dt><dd><ExtLink url={`https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(g.companies_house_no)}`}>{g.companies_house_no}</ExtLink></dd></div>}
          {g.sec_cik && <div><dt>SEC CIK</dt><dd>{g.sec_cik}</dd></div>}
          {g.lei && <div><dt>LEI</dt><dd>{g.lei}</dd></div>}
          <div><dt>Sanctions last checked</dt><dd>{fmtDateTime(g.screened_at, "Never")}</dd></div>
          {screening && (
            <div>
              <dt>Latest check</dt>
              <dd>
                {SANCTIONS_LABEL[screening.status] ?? screening.status}
                {screening.lists_checked?.length ? ` against ${screening.lists_checked.join(", ")}` : ""}
                {Array.isArray(screening.hits) && screening.hits.length > 0 ? ` · ${screening.hits.length} possible hit(s)` : ""}
              </dd>
            </div>
          )}
          <div><dt>First seen</dt><dd><ExtLink url={g.source_url}>{fmtDateTime(g.retrieved_at)}</ExtLink></dd></div>
        </dl>
      </section>
      <section className="stack">
        <h2>Opportunities ({opps.length})</h2>
        {opps.length === 0 ? <Empty>None linked.</Empty> : (
          <ul className="list">
            {opps.map((o) => (
              <li key={o.id} className="list-item">
                <div className="list-main">
                  <Link to={`/opportunities/${o.id}`}>{o.title}</Link>
                  <div className="meta">
                    <LineBadge line={o.line} />
                    <span className="badge">{SIDE_LABEL[o.side]}</span>
                    <GateBadge gate={o.gate} />
                    {o.specs?.mw != null && <span className="muted">{fmtMW(o.specs.mw)}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="stack">
        <h2>Signals ({signals.length})</h2>
        {signals.length === 0 ? <Empty>None linked.</Empty> : (
          <ul className="list">
            {signals.map((s) => (
              <li key={s.id} className="list-item">
                <div className="list-main">
                  <Link to={`/signals/${s.id}`}>{s.title}</Link>
                  {s.quote && <blockquote>{s.quote}</blockquote>}
                  <div className="meta">
                    <LineBadge line={s.line} />
                    <Confidence value={s.confidence} />
                    <span className="muted">{fmtDateTime(s.retrieved_at)}</span>
                    <ExtLink url={s.source_url}>Open source</ExtLink>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
