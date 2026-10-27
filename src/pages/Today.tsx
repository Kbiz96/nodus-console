import { Link } from "react-router-dom";
import { supabase, must, mustCount } from "../lib/supabase.ts";
import { MATCH_CARD_COLS } from "../lib/data.ts";
import { useLoad } from "../lib/useLoad.ts";
import { fmtDateTime, fmtGBP, fmtNumber, ukDayStartIso, ukMonthStart } from "../lib/format.ts";
import { LINES, LINE_LABEL } from "../lib/labels.ts";
import type { MatchCardRow } from "../lib/types.ts";
import MatchCard from "../components/MatchCard.tsx";
import TodayCrm from "../components/TodayCrm.tsx";
import Scoreboard from "../components/Scoreboard.tsx";
import { Confidence, CountUp, Empty, ErrorBox, ExtLink, LineBadge, Loading, useTitle } from "../components/ui.tsx";
import { CLOSED_STAGES, DEAL_STAGES } from "../lib/crm.ts";

interface Blocked {
  id: number;
  at: string;
  action: string;
  entity_table: string | null;
  entity_id: string | null;
  detail: Record<string, unknown> | null;
}
interface TopSignal {
  id: string;
  title: string;
  line: string | null;
  confidence: number;
  source_url: string;
  sources: { name: string } | null;
}

async function load() {
  const dayAgo = new Date(Date.now() - 24 * 3600e3).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600e3).toISOString();
  const countNew = (line: string | null) => {
    let q = supabase.from("signals").select("id", { count: "exact", head: true }).gte("created_at", dayAgo);
    q = line ? q.eq("line", line) : q.is("line", null);
    return q.then((r) => mustCount(r).count);
  };
  const [matches, lineCounts, otherCount, topSignals, blocked, aiQueue, spend] = await Promise.all([
    supabase
      .from("v_match_cards")
      .select(MATCH_CARD_COLS)
      .in("status", ["proposed", "shortlisted"])
      .order("total_score", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(10)
      .then((r) => must(r) as unknown as MatchCardRow[]),
    Promise.all(LINES.map((l) => countNew(l))),
    countNew(null),
    supabase
      .from("signals")
      .select("id,title,line,confidence,source_url,sources(name)")
      .gte("created_at", dayAgo)
      .order("confidence", { ascending: false })
      .order("retrieved_at", { ascending: false })
      .limit(10)
      .then((r) => must(r) as unknown as TopSignal[]),
    supabase
      .from("audit_log")
      .select("id,at,action,entity_table,entity_id,detail")
      .in("action", ["match_blocked", "sanctions_hit"])
      .gte("at", weekAgo)
      .order("at", { ascending: false })
      .limit(50)
      .then((r) => must(r) as Blocked[]),
    supabase
      .from("ai_tasks")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .then((r) => mustCount(r).count),
    supabase
      .from("llm_calls")
      .select("cost_gbp")
      .gte("at", ukDayStartIso(ukMonthStart()))
      .limit(10000)
      .then((r) => (must(r) as { cost_gbp: number | string }[]).reduce((a, x) => a + (Number(x.cost_gbp) || 0), 0)),
  ]);
  const byLine = new Map<string, number>(LINES.map((l, i) => [l, lineCounts[i]]));
  const newTotal = lineCounts.reduce((a, b) => a + b, 0) + otherCount;
  return { matches, byLine, otherCount, newTotal, topSignals, blocked, aiQueue, spend };
}

const ukLong = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });

export default function Today() {
  useTitle("Daily report");
  return (
    <div className="stack-lg">
      <header className="today-head page-head">
        <div className="section-head">
          <span className="eyebrow">Engine and CRM</span>
          <h1>Daily report</h1>
          <p className="muted">Your approvals, actions and deals due first; then this week&rsquo;s scoreboard and what the engine found.</p>
        </div>
        <div className="today-date">
          <b>{ukLong.format(new Date())}</b>
          UK time
        </div>
      </header>
      <Scoreboard />
      <div className="cockpit">
        <div>
          <TodayCrm />
        </div>
        <div>
          <Pipeline />
          <EngineToday />
        </div>
      </div>
    </div>
  );
}

/** Open deals by stage, as a bar per stage. Read-only. */
function Pipeline() {
  const { data, error, loading, reload } = useLoad(
    async () =>
      await supabase
        .from("deals")
        .select("stage")
        .limit(2000)
        .then((r) => must(r) as { stage: string | null }[]),
    "pipeline",
  );
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Loading what="Counting the pipeline…" />;
  if (!data) return null;
  const counts = new Map<string, number>();
  for (const d of data) {
    const k = d.stage || "No stage";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const order = [...DEAL_STAGES.filter((st) => !CLOSED_STAGES.includes(st)), "No stage", ...CLOSED_STAGES];
  const rows = order.map((st) => ({ stage: st, n: counts.get(st) ?? 0 })).filter((r) => r.n > 0);
  const max = Math.max(1, ...rows.map((r) => r.n));
  const open = data.filter((d) => !CLOSED_STAGES.includes(d.stage ?? "")).length;
  return (
    <section className="stack">
      <div className="sec-title">
        <h2>Pipeline</h2>
        <span className="count">{fmtNumber(open)} open</span>
      </div>
      {rows.length === 0 ? (
        <Empty>No deals yet.</Empty>
      ) : (
        <div className="pipeline">
          {rows.map((r) => (
            <div key={r.stage} className="pipe-row">
              <Link to="/deals">{r.stage}</Link>
              <div className="pipe-bar" aria-hidden><span style={{ width: `${(r.n / max) * 100}%` }} /></div>
              <span className="num">{fmtNumber(r.n)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** The engine's part of Today (matches, signals, blocked items), loaded separately so one cannot hide the other. */
function EngineToday() {
  const { data, error, loading, reload } = useLoad(load, "today");
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const { matches, byLine, otherCount, newTotal, topSignals, blocked, aiQueue, spend } = data;

  return (
    <>
      <section>
        <div className="sec-title">
          <h2>Engine</h2>
          <Link to="/engine" className="small">Open the engine view</Link>
        </div>
        <div className="engine-mini">
          <div className="stat">
            <span className="stat-num"><CountUp value={newTotal} /></span>
            <span className="stat-label">New signals (last 24h)</span>
          </div>
          <div className="stat">
            <span className="stat-num"><CountUp value={blocked.length} /></span>
            <span className="stat-label">Blocked (last 7 days)</span>
          </div>
          <div className="stat">
            <span className="stat-num"><CountUp value={aiQueue} /></span>
            <span className="stat-label">Waiting for AI reading</span>
          </div>
          <div className="stat">
            <span className="stat-num">{fmtGBP(spend)}</span>
            <span className="stat-label">Claude API spend this month (paid API is off)</span>
          </div>
        </div>
      </section>

      <section className="stack">
        <div className="sec-title">
          <h2>Top matches</h2>
          <span className="muted small">The ten strongest waiting for a decision</span>
        </div>
        {matches.length === 0 ? <Empty /> : matches.map((m) => <MatchCard key={m.id} m={m} onChanged={reload} />)}
        {matches.length > 0 && (
          <p>
            <Link to="/matches">See all matches</Link>
          </p>
        )}
      </section>

      <section className="stack">
        <div className="sec-title"><h2>New signals (last 24h)</h2></div>
        {newTotal === 0 ? (
          <Empty />
        ) : (
          <>
            <div className="chips">
              {LINES.map((l) => (
                <Link key={l} to={`/signals?line=${l}`} className="chip">
                  {LINE_LABEL[l]} <strong>{fmtNumber(byLine.get(l) ?? 0)}</strong>
                </Link>
              ))}
              {otherCount > 0 && (
                <span className="chip">
                  Other <strong>{fmtNumber(otherCount)}</strong>
                </span>
              )}
            </div>
            <h3 className="muted-head">Most reliable ten</h3>
            <ul className="list">
              {topSignals.map((s) => (
                <li key={s.id} className="list-item">
                  <div className="list-main">
                    <Link to={`/signals/${s.id}`}>{s.title}</Link>
                    <div className="meta">
                      <LineBadge line={s.line} />
                      <Confidence value={s.confidence} />
                      <span className="muted">{s.sources?.name}</span>
                      <ExtLink url={s.source_url} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="stack">
        <div className="sec-title"><h2>Blocked by sanctions or export control (last 7 days)</h2></div>
        {blocked.length === 0 ? (
          <p className="empty">Nothing blocked in the last 7 days.</p>
        ) : (
          <ul className="list">
            {blocked.map((b) => {
              const d = b.detail ?? {};
              const who = (d.organisation as string) || (d.name as string) || null;
              const reason =
                (d.reason as string) ||
                (b.action === "sanctions_hit" ? `Possible sanctions list match (${String(d.status ?? "review")})` : "Blocked");
              const href =
                b.entity_table === "opportunities" && b.entity_id
                  ? `/opportunities/${b.entity_id}`
                  : b.entity_table === "organisations" && b.entity_id
                    ? `/organisations/${b.entity_id}`
                    : b.entity_table === "matches" && b.entity_id
                      ? `/matches/${b.entity_id}`
                      : null;
              return (
                <li key={b.id} className="list-item">
                  <div className="list-main">
                    <strong>{b.action === "sanctions_hit" ? "Sanctions check" : "Match blocked"}</strong>
                    {who && <> — {who}</>}: {reason}
                    <div className="meta">
                      <span className="muted">{fmtDateTime(b.at)}</span>
                      {href && <Link to={href}>Open</Link>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
