import { Link } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { useLoad } from "../lib/useLoad.ts";
import { fmtDate, fmtDateTime, fmtGBP, reference, ukDayStartIso, ukMonthStart } from "../lib/format.ts";
import {
  ORIGIN_LABEL,
  REQUEST_STATUS_LABEL,
  creditsToApprove,
  fmtCredits,
  providerLabel,
  summariseSpend,
  type SpendRow,
} from "../lib/enrich.ts";
import { ENRICH_CREDITS_PER_OPPORTUNITY_ESTIMATE, ENRICH_MONTHLY_CAP_CREDITS, ENRICH_PER_RUN_CAP_CREDITS } from "../config.ts";
import ApproveCredits from "../components/ApproveCredits.tsx";
import { Empty, ErrorBox, Loading, useTitle } from "../components/ui.tsx";

interface Req {
  id: string;
  opportunity_id: string;
  origin: string;
  status: string;
  estimated_credits: number | null;
  credits_used: number | string;
  note: string | null;
  created_at: string;
  done_at: string | null;
  opportunities: { title: string } | null;
}

const REQ_COLS = "id,opportunity_id,origin,status,estimated_credits,credits_used,note,created_at,done_at,opportunities(title)";

const STATUS_TONE: Record<string, string> = { pending: "wait", needs_approval: "warn", done: "good", failed: "bad", skipped: "off" };

async function load() {
  const since = ukDayStartIso(ukMonthStart());
  const [spend, recent, waiting, claude] = await Promise.all([
    supabase
      .from("provider_spend")
      .select("at,provider,credits,opportunity_id")
      .gte("at", since)
      .order("at", { ascending: false })
      .limit(10000)
      .then((r) => must(r) as SpendRow[]),
    supabase
      .from("enrich_requests")
      .select(REQ_COLS)
      .order("created_at", { ascending: false })
      .limit(30)
      .then((r) => must(r) as unknown as Req[]),
    supabase
      .from("enrich_requests")
      .select(REQ_COLS)
      .eq("status", "needs_approval")
      .order("created_at")
      .limit(100)
      .then((r) => must(r) as unknown as Req[]),
    supabase
      .from("llm_calls")
      .select("cost_gbp")
      .gte("at", since)
      .limit(10000)
      .then((r) => (must(r) as { cost_gbp: number | string }[]).reduce((a, x) => a + (Number(x.cost_gbp) || 0), 0)),
  ]);
  // Biggest single run this month, to compare with the per-run cap.
  const biggest = recent
    .filter((q) => +new Date(q.done_at ?? q.created_at) >= +new Date(since))
    .reduce((a, q) => Math.max(a, Number(q.credits_used) || 0), 0);
  const titles = new Map<string, string>();
  for (const q of [...recent, ...waiting]) if (q.opportunities?.title) titles.set(q.opportunity_id, q.opportunities.title);
  return { summary: summariseSpend(spend), recent, waiting: waiting.filter((q) => q.status === "needs_approval"), claude, biggest, titles };
}

function OppRef({ id, title }: { id: string | null; title?: string }) {
  if (!id) return <span className="muted">Not linked to an opportunity</span>;
  return (
    <>
      <Link to={`/opportunities/${id}`}>{reference(id)}</Link>
      {title && <div className="muted small">{title}</div>}
    </>
  );
}

export default function Spend() {
  useTitle("Spend");
  const { data, error, loading, reload } = useLoad(load, "spend");
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const { summary, recent, waiting, claude, biggest, titles } = data;
  const used = summary.total;
  const left = Math.max(0, ENRICH_MONTHLY_CAP_CREDITS - used);
  const pct = Math.min(100, (used / ENRICH_MONTHLY_CAP_CREDITS) * 100);
  const tone = used >= ENRICH_MONTHLY_CAP_CREDITS ? "over" : pct >= 80 ? "near" : "";

  return (
    <div className="stack-lg">
      <section>
        <div className="section-head">
          <h1>Spend</h1>
          <p className="muted">Credits used this month to find decision makers (Apollo, Clay and Vibe Prospecting), and anything waiting for your OK.</p>
        </div>
        <div className="stats">
          <div className="stat">
            <span className="stat-num">{fmtCredits(used)} / {ENRICH_MONTHLY_CAP_CREDITS}</span>
            <span className="stat-label">Credits used this month</span>
          </div>
          <div className="stat">
            <span className="stat-num">{fmtCredits(left)}</span>
            <span className="stat-label">Credits left this month</span>
          </div>
          <div className="stat">
            <span className="stat-num">{fmtCredits(biggest)} / {ENRICH_PER_RUN_CAP_CREDITS}</span>
            <span className="stat-label">Biggest run this month (cap per run)</span>
          </div>
          <div className="stat">
            <span className="stat-num">{fmtGBP(claude)}</span>
            <span className="stat-label">Claude API spend this month (paid API is off)</span>
          </div>
        </div>
        <div className="meter" style={{ marginTop: "0.75rem" }}>
          <span className="bar-track" role="img" aria-label={`${fmtCredits(used)} of ${ENRICH_MONTHLY_CAP_CREDITS} monthly credits used`}>
            <span className={`bar-fill ${tone}`} style={{ width: `${pct}%` }} />
          </span>
          <span className="muted small">
            Over either cap, a request waits for your approval below. Nothing runs over a cap without your OK.
          </span>
        </div>
      </section>

      <section className="stack">
        <h2>Waiting for your approval ({waiting.length})</h2>
        {waiting.length === 0 ? (
          <Empty>Nothing waiting for approval.</Empty>
        ) : (
          <ul className="list">
            {waiting.map((q) => {
              const n = creditsToApprove(q.estimated_credits, ENRICH_CREDITS_PER_OPPORTUNITY_ESTIMATE);
              return (
                <li key={q.id} className="list-item card">
                  <div className="list-main stack-xs">
                    <div><OppRef id={q.opportunity_id} title={q.opportunities?.title} /></div>
                    <p className="small">
                      Estimated {fmtCredits(q.estimated_credits ?? n)} credits · asked {fmtDateTime(q.created_at)} by {ORIGIN_LABEL[q.origin] ?? q.origin}
                    </p>
                    {q.note && <p className="small muted">{q.note}</p>}
                    <ApproveCredits id={q.id} credits={n} onDone={reload} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="stack">
        <h2>By provider (this month)</h2>
        {summary.byProvider.length === 0 ? (
          <Empty>No credits used this month.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table stack-sm">
              <thead>
                <tr><th>Provider</th><th className="num">Look-ups</th><th className="num">Credits</th></tr>
              </thead>
              <tbody>
                {summary.byProvider.map((p) => (
                  <tr key={p.provider}>
                    <td className="title-cell">{providerLabel(p.provider)}</td>
                    <td data-label="Look-ups" className="num">{p.actions}</td>
                    <td data-label="Credits" className="num">{fmtCredits(p.credits)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="stack">
        <h2>By opportunity (this month)</h2>
        {summary.byOpportunity.length === 0 ? (
          <Empty>No credits used this month.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table stack-sm">
              <thead>
                <tr><th>Opportunity</th><th className="num">Credits</th><th>Last used</th></tr>
              </thead>
              <tbody>
                {summary.byOpportunity.map((o) => (
                  <tr key={o.opportunityId ?? "none"}>
                    <td className="title-cell"><OppRef id={o.opportunityId} title={o.opportunityId ? titles.get(o.opportunityId) : undefined} /></td>
                    <td data-label="Credits" className="num">{fmtCredits(o.credits)}</td>
                    <td data-label="Last used">{fmtDate(o.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="stack">
        <h2>Recent requests</h2>
        {recent.length === 0 ? (
          <Empty>No enrichment requests yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table stack-sm">
              <thead>
                <tr><th>Opportunity</th><th>Status</th><th>Asked</th><th>Asked by</th><th className="num">Credits used</th><th>Note</th></tr>
              </thead>
              <tbody>
                {recent.map((q) => (
                  <tr key={q.id}>
                    <td className="title-cell"><OppRef id={q.opportunity_id} title={q.opportunities?.title} /></td>
                    <td data-label="Status">
                      <span className={`pill pill-${STATUS_TONE[q.status] ?? "off"}`}>{REQUEST_STATUS_LABEL[q.status] ?? q.status}</span>
                      {q.done_at && <div className="muted small">{fmtDateTime(q.done_at)}</div>}
                    </td>
                    <td data-label="Asked">{fmtDateTime(q.created_at)}</td>
                    <td data-label="Asked by">{ORIGIN_LABEL[q.origin] ?? q.origin}</td>
                    <td data-label="Credits used" className="num">{fmtCredits(q.credits_used)}</td>
                    <td data-label="Note" className="small">{q.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
