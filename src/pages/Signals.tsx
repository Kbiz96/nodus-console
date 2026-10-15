import { Link, useSearchParams } from "react-router-dom";
import { supabase, must, mustCount } from "../lib/supabase.ts";
import { dateRange, searchAll } from "../lib/data.ts";
import { pageFrom, parseFilters, type Filters } from "../lib/filters.ts";
import { useLoad } from "../lib/useLoad.ts";
import { fmtDateTime, fmtNumber } from "../lib/format.ts";
import FilterBar from "../components/FilterBar.tsx";
import { Confidence, Empty, ErrorBox, ExtLink, LineBadge, Loading, Pager, useTitle } from "../components/ui.tsx";

const PAGE = 50;
const MAX = 200; // the latest 200 when nothing is searched

interface SigRow {
  id: string; line: string | null; signal_type: string; title: string; quote: string | null; source_url: string;
  confidence: number; retrieved_at: string; sources: { name: string } | null;
}

async function load(f: Filters, page: number) {
  const filtered = Boolean(f.q || f.line || f.source || f.country || f.minMw || f.from || f.to);
  let ids: string[] | null = null;
  if (f.q) {
    const r = await searchAll({ ...f, country: null, minMw: null }, 200);
    ids = r.signals.map((s) => s.id);
    if (ids.length === 0) return { rows: [] as SigRow[], total: 0, filtered };
  }
  const cols = "id,line,signal_type,title,quote,source_url,confidence,retrieved_at,sources(name)";
  let q = supabase
    .from("signals")
    .select(f.country ? `${cols},opportunity_signals!inner(opportunities!inner(country))` : cols, { count: "exact" });
  if (ids) q = q.in("id", ids);
  if (f.line) q = q.eq("line", f.line);
  if (f.source) q = q.eq("source_id", f.source);
  if (f.country) q = q.eq("opportunity_signals.opportunities.country", f.country);
  if (f.minMw) q = q.or(`data->mw.gte.${f.minMw},data->nameplate_mw.gte.${f.minMw}`);
  const d = dateRange(f);
  if (d.gte) q = q.gte("retrieved_at", d.gte);
  if (d.lt) q = q.lt("retrieved_at", d.lt);
  q = q.order("retrieved_at", { ascending: false }).order("id");
  const res = mustCount(await q.range((page - 1) * PAGE, page * PAGE - 1));
  const total = filtered ? res.count : Math.min(res.count, MAX);
  return { rows: res.rows as unknown as SigRow[], total, filtered };
}

export default function Signals() {
  useTitle("Signals");
  const [sp] = useSearchParams();
  const f = parseFilters(sp);
  const page = pageFrom(sp);
  const { data, error, loading, reload } = useLoad(() => load(f, page), sp.toString());
  const sources = useLoad(
    async () => must(await supabase.from("sources").select("id,name").order("name")) as { id: string; name: string }[],
    "sources",
  );
  const filtered = Boolean(f.q || f.line || f.source || f.country || f.minMw || f.from || f.to);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Signals</h1>
        <p className="muted">
          Individual facts the engine found, each with the exact words from the source.{" "}
          {filtered ? (data ? `${fmtNumber(data.total)} found.` : "") : `The latest ${MAX}.`}
        </p>
      </div>
      <FilterBar path="/signals" filters={f} fields={["q", "line", "source", "country", "mw", "dates"]} sources={sources.data ?? []} />
      {error && !data ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data || data.rows.length === 0 ? (
        <Empty>{filtered ? "Nothing fits these filters." : undefined}</Empty>
      ) : (
        <ul className="list">
          {data.rows.map((s) => (
            <li key={s.id} className="list-item card">
              <div className="list-main">
                <Link to={`/signals/${s.id}`} className="strong">{s.title}</Link>
                {s.quote && <blockquote>{s.quote}</blockquote>}
                <div className="meta">
                  <LineBadge line={s.line} />
                  <Confidence value={s.confidence} />
                  <span className="muted">{s.sources?.name}</span>
                  <span className="muted">{fmtDateTime(s.retrieved_at)}</span>
                  <ExtLink url={s.source_url}>Open source</ExtLink>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager
        basePath="/signals"
        params={{ q: f.q, line: f.line, source: f.source, country: f.country, mw: f.minMw, from: f.from, to: f.to }}
        page={page}
        pageSize={PAGE}
        total={data?.total ?? 0}
      />
    </div>
  );
}
