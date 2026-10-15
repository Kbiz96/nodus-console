import { supabase, must } from "../lib/supabase.ts";
import { useLoad } from "../lib/useLoad.ts";
import { fmtDateTime, fmtGBP, fmtNumber, truncate } from "../lib/format.ts";
import { ACCESS_LABEL, TIER_LABEL } from "../lib/labels.ts";
import { Empty, ErrorBox, Loading, useTitle } from "../components/ui.tsx";

interface Src {
  id: string;
  name: string;
  tier: string;
  access_type: string;
  region: string;
  enabled: boolean;
  auto_disabled: boolean;
  last_success_at: string | null;
  consecutive_failures: number;
  last_error: string | null;
  records_yielded: number | string;
  monthly_cost_gbp: number;
}

export function sourceStatus(s: Pick<Src, "auto_disabled" | "enabled" | "consecutive_failures" | "access_type">): { label: string; tone: string; why: string } {
  if (s.auto_disabled) return { label: "Needs attention", tone: "bad", why: "Switched itself off after repeated failures." };
  if (s.enabled && s.consecutive_failures > 0) return { label: "Needs attention", tone: "bad", why: `Failed the last ${s.consecutive_failures} time(s).` };
  if (!s.enabled) return { label: "Switched off", tone: "off", why: s.access_type === "manual" ? "Checked by hand, not automatically." : "Not turned on." };
  return { label: "Working", tone: "good", why: "" };
}

const rank = (s: Src) => (sourceStatus(s).label === "Needs attention" ? 0 : s.enabled ? 1 : 2);

export default function Sources() {
  useTitle("Sources");
  const { data, error, loading, reload } = useLoad(async () => {
    const rows = must(
      await supabase
        .from("sources")
        .select("id,name,tier,access_type,region,enabled,auto_disabled,last_success_at,consecutive_failures,last_error,records_yielded,monthly_cost_gbp")
        .order("name"),
    ) as Src[];
    return rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, "sources");
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  const rows = data ?? [];
  const working = rows.filter((r) => sourceStatus(r).label === "Working").length;
  const attention = rows.filter((r) => sourceStatus(r).label === "Needs attention").length;
  const cost = rows.filter((r) => r.enabled).reduce((a, r) => a + Number(r.monthly_cost_gbp || 0), 0);
  return (
    <div className="stack">
      <div className="section-head">
        <h1>Sources</h1>
        <p className="muted">Where the engine looks every morning, and whether each one is working.</p>
      </div>
      <div className="stats">
        <div className="stat"><span className="stat-num">{working}</span><span className="stat-label">Working</span></div>
        <div className="stat"><span className="stat-num">{attention}</span><span className="stat-label">Need attention</span></div>
        <div className="stat"><span className="stat-num">{rows.length - working - attention}</span><span className="stat-label">Switched off</span></div>
        <div className="stat"><span className="stat-num">{fmtGBP(cost)}</span><span className="stat-label">Monthly cost (switched on)</span></div>
      </div>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="table-wrap">
          <table className="table stack-sm">
            <thead>
              <tr>
                <th>Source</th>
                <th>Status</th>
                <th>Type</th>
                <th>Last worked</th>
                <th className="num">Failures in a row</th>
                <th>Last problem</th>
                <th className="num">Records found</th>
                <th className="num">Monthly cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const st = sourceStatus(s);
                return (
                  <tr key={s.id}>
                    <td className="title-cell">
                      {s.name}
                      <div className="muted small">{TIER_LABEL[s.tier] ?? s.tier} · {s.region}</div>
                    </td>
                    <td data-label="Status">
                      <span className={`pill pill-${st.tone}`}>{st.label}</span>
                      {st.why && <div className="muted small">{st.why}</div>}
                    </td>
                    <td data-label="Type">{ACCESS_LABEL[s.access_type] ?? s.access_type}</td>
                    <td data-label="Last worked">{fmtDateTime(s.last_success_at, "Never")}</td>
                    <td data-label="Failures in a row" className="num">{s.consecutive_failures}</td>
                    <td data-label="Last problem" className="small" title={s.last_error ?? undefined}>{truncate(s.last_error, 90) || "—"}</td>
                    <td data-label="Records found" className="num">{fmtNumber(s.records_yielded)}</td>
                    <td data-label="Monthly cost" className="num">{fmtGBP(s.monthly_cost_gbp)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
