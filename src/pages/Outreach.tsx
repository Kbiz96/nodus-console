import { Link, useSearchParams } from "react-router-dom";
import { supabase, must, mustCount } from "../lib/supabase.ts";
import { useLoad } from "../lib/useLoad.ts";
import { OUTREACH_STATUSES, OUTREACH_STATUS_LABEL } from "../lib/crm.ts";
import { fmtNumber } from "../lib/format.ts";
import type { Outreach as OutreachRow } from "../lib/types.ts";
import { OUTREACH_COLS } from "../components/TodayCrm.tsx";
import { DraftCard, ManualCard, OutreachLine } from "../components/OutreachCards.tsx";
import { Empty, ErrorBox, Loading, useTitle } from "../components/ui.tsx";

const LIMIT = 200;

async function load(status: string) {
  const [counts, rows] = await Promise.all([
    Promise.all(
      OUTREACH_STATUSES.map((s) =>
        supabase.from("outreach").select("id", { count: "exact", head: true }).eq("status", s).then((r) => mustCount(r).count),
      ),
    ),
    supabase.from("outreach").select(OUTREACH_COLS).eq("status", status).order("created_at", { ascending: false }).limit(LIMIT)
      .then((r) => must(r) as unknown as OutreachRow[]),
  ]);
  return { counts: new Map(OUTREACH_STATUSES.map((s, i) => [s as string, counts[i]])), rows };
}

export default function Outreach() {
  useTitle("Outreach");
  const [sp] = useSearchParams();
  const raw = sp.get("status") ?? "draft";
  const status = (OUTREACH_STATUSES as readonly string[]).includes(raw) ? raw : "draft";
  const { data, error, loading, reload } = useLoad(() => load(status), `outreach-${status}`);

  return (
    <div className="stack-lg">
      <div className="section-head">
        <h1>Outreach</h1>
        <p className="muted">Every email and LinkedIn message, by status. Nothing is sent without your approval.</p>
      </div>
      <nav className="tabs" aria-label="Status">
        {OUTREACH_STATUSES.map((s) => (
          <Link key={s} to={`/outreach?status=${s}`} className={s === status ? "active" : undefined}>
            {OUTREACH_STATUS_LABEL[s]} {data ? `(${fmtNumber(data.counts.get(s) ?? 0)})` : ""}
          </Link>
        ))}
      </nav>
      {error && !data ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data || data.rows.length === 0 ? (
        <Empty>Nothing here.</Empty>
      ) : (
        <section className="stack">
          {status === "draft"
            ? data.rows.map((o) => <DraftCard key={`${o.id}-${o.subject ?? ""}-${o.body ?? ""}`} o={o} onChanged={reload} />)
            : status === "manual"
              ? data.rows.map((o) => <ManualCard key={o.id} o={o} onChanged={reload} />)
              : <ul className="list">{data.rows.map((o) => <OutreachLine key={o.id} o={o} />)}</ul>}
          {(data.counts.get(status) ?? 0) > data.rows.length && <p className="muted small">Showing the newest {LIMIT}.</p>}
        </section>
      )}
    </div>
  );
}
