import { Link, useSearchParams } from "react-router-dom";
import { supabase, mustCount } from "../lib/supabase.ts";
import { dateRange, searchAll } from "../lib/data.ts";
import { hrefWith, pageFrom, parseFilters, type Filters } from "../lib/filters.ts";
import { useLoad } from "../lib/useLoad.ts";
import { fmtDate, fmtMW, fmtNumber } from "../lib/format.ts";
import { LINES, LINE_LABEL, SIDE_LABEL } from "../lib/labels.ts";
import FilterBar from "../components/FilterBar.tsx";
import { Empty, ErrorBox, GateBadge, Loading, Pager, useTitle } from "../components/ui.tsx";

const PAGE = 50;

interface OppRow {
  id: string;
  line: string;
  side: string;
  title: string;
  region: string | null;
  country: string | null;
  specs: Record<string, unknown> | null;
  timing_from: string | null;
  credibility: number;
  gate: string;
  created_at: string;
  opportunity_signals: { count: number }[];
}

async function load(f: Filters, page: number) {
  let ids: string[] | null = null;
  let capped = false;
  if (f.q) {
    const r = await searchAll(f, 200);
    ids = r.opportunities.map((o) => o.id);
    capped = ids.length >= 200;
    if (ids.length === 0) return { rows: [] as OppRow[], total: 0, capped };
  }
  let q = supabase
    .from("opportunities")
    .select("id,line,side,title,region,country,specs,timing_from,credibility,gate,created_at,opportunity_signals(count)", { count: "exact" });
  if (ids) q = q.in("id", ids);
  if (f.line) q = q.eq("line", f.line);
  if (f.side) q = q.eq("side", f.side);
  if (f.gate) q = q.eq("gate", f.gate);
  if (f.country) q = q.eq("country", f.country);
  if (f.minMw) q = q.gte("specs->mw", f.minMw);
  const d = dateRange(f);
  if (d.gte) q = q.gte("created_at", d.gte);
  if (d.lt) q = q.lt("created_at", d.lt);
  q = q.order("created_at", { ascending: false }).order("id");
  const { rows, count } = mustCount(await q.range((page - 1) * PAGE, page * PAGE - 1));
  return { rows: rows as unknown as OppRow[], total: count, capped };
}

export default function Opportunities() {
  useTitle("Opportunities");
  const [sp] = useSearchParams();
  const f = parseFilters(sp);
  const page = pageFrom(sp);
  const { data, error, loading, reload } = useLoad(() => load(f, page), sp.toString());
  const tab = (line: string | null) => hrefWith("/opportunities", { line, side: f.side, q: f.q });
  const filtered = Boolean(f.q || f.side || f.country || f.minMw || f.from || f.to || f.gate);

  return (
    <div className="stack">
      <div className="section-head page-head-block">
        <span className="eyebrow">Pipeline</span>
        <h1>Opportunities</h1>
        <p className="muted">
          Each one is a real-world situation: someone with power, kit, land or capital to offer (supply), or someone
          looking for it (need).
        </p>
      </div>
      <nav className="tabs" aria-label="Lines">
        <Link to={tab(null)} className={!f.line ? "active" : undefined}>All</Link>
        {LINES.map((l) => (
          <Link key={l} to={tab(l)} className={f.line === l ? "active" : undefined}>{LINE_LABEL[l]}</Link>
        ))}
      </nav>
      <FilterBar
        path="/opportunities"
        filters={f}
        fields={["q", "side", "gate", "country", "mw", "dates"]}
        hidden={{ line: f.line }}
        qPlaceholder="Name, place or anything in the details"
      />
      {error && !data ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data || data.rows.length === 0 ? (
        <Empty>{filtered ? "Nothing fits these filters." : undefined}</Empty>
      ) : (
        <>
          <p className="muted small">
            {fmtNumber(data.total)} found{data.capped ? " (closest 200 to your words)" : ""}
          </p>
          <div className="table-wrap">
            <table className="table stack-sm">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Side</th>
                  <th>Region</th>
                  <th className="num">MW</th>
                  <th>Timing</th>
                  <th className="num">Credibility</th>
                  <th>Step</th>
                  <th className="num">Signals</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((o) => (
                  <tr key={o.id}>
                    <td className="title-cell">
                      <Link to={`/opportunities/${o.id}`}>{o.title}</Link>
                      {!f.line && <div className="muted small">{LINE_LABEL[o.line]}</div>}
                    </td>
                    <td data-label="Side">{SIDE_LABEL[o.side]}</td>
                    <td data-label="Region">{[o.region, o.country].filter(Boolean).join(", ") || "—"}</td>
                    <td data-label="MW" className="num">{fmtMW(o.specs?.mw)}</td>
                    <td data-label="Timing">{fmtDate(o.timing_from)}</td>
                    <td data-label="Credibility" className="num">{fmtNumber(o.credibility)}</td>
                    <td data-label="Step"><GateBadge gate={o.gate} /></td>
                    <td data-label="Signals" className="num">{o.opportunity_signals?.[0]?.count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Pager
        basePath="/opportunities"
        params={{ q: f.q, line: f.line, side: f.side, gate: f.gate, country: f.country, mw: f.minMw, from: f.from, to: f.to }}
        page={page}
        pageSize={PAGE}
        total={data?.total ?? 0}
      />
    </div>
  );
}
