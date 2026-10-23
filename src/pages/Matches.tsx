import { Link, useSearchParams } from "react-router-dom";
import { supabase, mustCount, must } from "../lib/supabase.ts";
import { MATCH_CARD_COLS, searchAll } from "../lib/data.ts";
import { pageFrom, parseFilters, type Filters } from "../lib/filters.ts";
import { useLoad } from "../lib/useLoad.ts";
import { fmtNumber } from "../lib/format.ts";
import type { MatchCardRow } from "../lib/types.ts";
import MatchCard from "../components/MatchCard.tsx";
import FilterBar from "../components/FilterBar.tsx";
import { Empty, ErrorBox, Loading, Pager, useTitle } from "../components/ui.tsx";

const PAGE = 25;
const OPP_CAP = 100; // how many opportunities a country / size filter can look through

async function load(f: Filters, page: number) {
  let ids: string[] | null = null;
  let capped = false;
  if (f.q) {
    const r = await searchAll({ ...f, line: null, country: null, minMw: null, from: null, to: null }, 200);
    ids = r.matches.map((m) => m.id);
    capped = r.matches.length >= 200;
  }
  let oppIds: string[] | null = null;
  if (f.country || f.minMw) {
    let q = supabase.from("opportunities").select("id").order("credibility", { ascending: false }).limit(OPP_CAP);
    if (f.country) q = q.eq("country", f.country);
    if (f.minMw) q = q.gte("specs->mw", f.minMw);
    if (f.line) q = q.eq("line", f.line);
    oppIds = (must(await q) as { id: string }[]).map((o) => o.id);
    capped = capped || oppIds.length >= OPP_CAP;
  }
  if ((ids && ids.length === 0) || (oppIds && oppIds.length === 0)) return { rows: [] as MatchCardRow[], total: 0, capped };

  let q = supabase.from("v_match_cards").select(MATCH_CARD_COLS, { count: "exact" });
  if (ids) q = q.in("id", ids);
  if (oppIds) q = q.or(`supply_id.in.(${oppIds.join(",")}),need_id.in.(${oppIds.join(",")})`);
  if (f.line) q = q.eq("line", f.line);
  if (f.status) q = q.eq("status", f.status);
  q = q.order("total_score", { ascending: false }).order("created_at", { ascending: false }).order("id");
  const { rows, count } = mustCount(await q.range((page - 1) * PAGE, page * PAGE - 1));
  return { rows: rows as unknown as MatchCardRow[], total: count, capped };
}

export default function Matches() {
  useTitle("Matches");
  const [sp] = useSearchParams();
  const f = parseFilters(sp);
  const page = pageFrom(sp);
  const { data, error, loading, reload } = useLoad(() => load(f, page), sp.toString());
  const filtered = Boolean(f.q || f.line || f.status || f.country || f.minMw);

  return (
    <div className="stack">
      <nav className="tabs" aria-label="Match views">
        <Link to="/engine">Engine view</Link>
        <Link to="/matches" className="active" aria-current="page">List</Link>
      </nav>
      <div className="section-head page-head-block">
        <span className="eyebrow">Pipeline</span>
        <h1>Matches</h1>
        <p className="muted">
          Every pairing the engine has proposed. Shortlist the good ones, reject the rest with a reason, and send the
          best to your CRM as a file. {data && data.total > 0 && <>Showing {fmtNumber(data.total)}.</>}
        </p>
      </div>
      <FilterBar path="/matches" filters={f} fields={["q", "line", "status", "country", "mw"]} />
      {error && !data ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data || data.rows.length === 0 ? (
        filtered ? <Empty>No matches fit these filters.</Empty> : <Empty />
      ) : (
        <>
          {data.capped && <p className="note">Only the closest results were checked. Add more words or filters to narrow it down.</p>}
          {data.rows.map((m) => <MatchCard key={m.id} m={m} onChanged={reload} />)}
        </>
      )}
      <Pager
        basePath="/matches"
        params={{ q: f.q, line: f.line, status: f.status, country: f.country, mw: f.minMw }}
        page={page}
        pageSize={PAGE}
        total={data?.total ?? 0}
      />
    </div>
  );
}
