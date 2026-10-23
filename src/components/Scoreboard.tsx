import { scoreboard } from "../lib/data.ts";
import { fmtDay } from "../lib/crm.ts";
import { useLoad } from "../lib/useLoad.ts";
import { fmtNumber } from "../lib/format.ts";
import { scoreRows, trackedLate, weekPeriods } from "../lib/scoreboard.ts";
import { ErrorBox, Loading } from "./ui.tsx";

async function load() {
  const { thisWeek, lastWeek } = weekPeriods();
  const [a, b] = await Promise.all([scoreboard(thisWeek.from, thisWeek.to), scoreboard(lastWeek.from, lastWeek.to)]);
  return { thisWeek, lastWeek, rows: scoreRows(a, b), trackingSince: a.tracking_since ?? b.tracking_since ?? null };
}

/** This week (Monday to Sunday, UK time) against last week. Read-only. */
export default function Scoreboard() {
  const { data, error, loading, reload } = useLoad(load, "scoreboard");
  return (
    <section>
      <div className="section-head">
        <h2>Scoreboard</h2>
        {data && (
          <p className="muted">
            This week ({fmtDay(data.thisWeek.firstDay)} – {fmtDay(data.thisWeek.lastDay)}) against last week.
          </p>
        )}
      </div>
      {error && !data ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading what="Counting this week…" />
      ) : data ? (
        <>
          <div className="stats">
            {data.rows.map((r) => (
              <div key={r.key} className="stat">
                <span className="stat-num">{fmtNumber(r.thisWeek)}</span>
                <span className="stat-label">{r.label}</span>
                <span className="stat-sub">
                  Last week {fmtNumber(r.lastWeek)}{" "}
                  <span className={`delta delta-${r.change.dir}`} aria-label={`change ${r.change.text}`}>{r.change.text}</span>
                </span>
              </div>
            ))}
          </div>
          {trackedLate(data.trackingSince, data.lastWeek.from) && (
            <p className="note">
              Meetings, NCNDAs and fee letters are counted from {fmtDay(String(data.trackingSince).slice(0, 10))}, when
              tracking began, so earlier weeks may show fewer.
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
