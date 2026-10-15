import { Link, useSearchParams } from "react-router-dom";
import { searchAll } from "../lib/data.ts";
import { hasAnyFilter, parseFilters } from "../lib/filters.ts";
import { useLoad } from "../lib/useLoad.ts";
import { fmtDate, fmtMW, fmtNumber } from "../lib/format.ts";
import { SIDE_LABEL } from "../lib/labels.ts";
import type { SearchAll } from "../lib/types.ts";
import FilterBar from "../components/FilterBar.tsx";
import { Confidence, Empty, ErrorBox, GateBadge, LineBadge, Loading, SanctionsBadge, Score, StatusBadge, useTitle } from "../components/ui.tsx";

const LIMIT = 50;
const TYPES = ["matches", "opportunities", "organisations", "signals", "mandates"] as const;
type T = (typeof TYPES)[number];
const TITLE: Record<T, string> = {
  matches: "Matches",
  opportunities: "Opportunities",
  organisations: "Organisations",
  signals: "Signals",
  mandates: "Mandates",
};

/** "50+" when the group reached the limit, otherwise the plain count. */
export function countLabel(n: number, limit = LIMIT): string {
  return n >= limit ? `${fmtNumber(limit)}+` : fmtNumber(n);
}

export default function Search() {
  useTitle("Search");
  const [sp] = useSearchParams();
  const f = parseFilters(sp);
  const active = hasAnyFilter(f);
  const { data, error, loading, reload } = useLoad<SearchAll | null>(
    () => (active ? searchAll(f, LIMIT) : Promise.resolve(null)),
    sp.toString(),
  );
  const counts = Object.fromEntries(TYPES.map((t) => [t, data?.[t]?.length ?? 0])) as Record<T, number>;
  const all = TYPES.reduce((a, t) => a + counts[t], 0);
  const jump = (t: T) => document.getElementById(`group-${t}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Search</h1>
        <p className="muted">
          Looks through organisations, opportunities, signals, matches and mandates. Several words must all appear. The
          line, country, date and size filters narrow the opportunities and signals.
        </p>
      </div>
      <FilterBar path="/search" filters={f} fields={["q", "line", "country", "mw", "dates"]} qPlaceholder="e.g. Ealing data centre" />

      {!active ? (
        <p className="empty">Type something to search for, or choose a filter.</p>
      ) : error && !data ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading what="Searching…" />
      ) : !data ? null : (
        <>
          <nav className="chips" aria-label="Result groups">
            {TYPES.map((t) => (
              <button key={t} type="button" className="chip" onClick={() => jump(t)} disabled={counts[t] === 0}>
                {TITLE[t]} <strong>{countLabel(counts[t])}</strong>
              </button>
            ))}
          </nav>
          {all === 0 && <Empty>Nothing found. Try fewer words or remove a filter.</Empty>}

          {counts.matches > 0 && (
            <section id="group-matches" className="stack">
              <h2>Matches ({countLabel(counts.matches)})</h2>
              <ul className="list">
                {data.matches.map((m) => (
                  <li key={m.id} className="list-item">
                    <Score value={m.total_score} />
                    <div className="list-main">
                      <Link to={`/matches/${m.id}`}>{m.title || "Match"}</Link>
                      <div className="meta"><StatusBadge status={m.status} /><span className="muted">{fmtDate(m.at)}</span></div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {counts.opportunities > 0 && (
            <section id="group-opportunities" className="stack">
              <h2>Opportunities ({countLabel(counts.opportunities)})</h2>
              <ul className="list">
                {data.opportunities.map((o) => (
                  <li key={o.id} className="list-item">
                    <div className="list-main">
                      <Link to={`/opportunities/${o.id}`}>{o.title}</Link>
                      <div className="meta">
                        <LineBadge line={o.line} />
                        <span className="badge">{SIDE_LABEL[o.side] ?? o.side}</span>
                        <GateBadge gate={o.gate} />
                        {o.mw != null && <span className="muted">{fmtMW(o.mw)}</span>}
                        <span className="muted">{[o.region, o.country].filter(Boolean).join(", ")}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {counts.opportunities >= LIMIT && (
                <p><Link to={`/opportunities?${sp.toString()}`}>See more opportunities →</Link></p>
              )}
            </section>
          )}

          {counts.organisations > 0 && (
            <section id="group-organisations" className="stack">
              <h2>Organisations ({countLabel(counts.organisations)})</h2>
              <ul className="list">
                {data.organisations.map((g) => (
                  <li key={g.id} className="list-item">
                    <div className="list-main">
                      <Link to={`/organisations/${g.id}`}>{g.title}</Link>
                      <div className="meta">
                        <SanctionsBadge status={g.status} />
                        {g.country && <span className="muted">{g.country}</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {counts.signals > 0 && (
            <section id="group-signals" className="stack">
              <h2>Signals ({countLabel(counts.signals)})</h2>
              <ul className="list">
                {data.signals.map((s) => (
                  <li key={s.id} className="list-item">
                    <div className="list-main">
                      <Link to={`/signals/${s.id}`}>{s.title}</Link>
                      <div className="meta">
                        <LineBadge line={s.line} />
                        <Confidence value={s.confidence} />
                        {s.at && <span className="muted">{fmtDate(s.at)}</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {counts.signals >= LIMIT && <p><Link to={`/signals?${sp.toString()}`}>See more signals →</Link></p>}
            </section>
          )}

          {counts.mandates > 0 && (
            <section id="group-mandates" className="stack">
              <h2>Mandates ({countLabel(counts.mandates)})</h2>
              <ul className="list">
                {data.mandates.map((m) => (
                  <li key={m.id} className="list-item">
                    <div className="list-main">
                      <Link to={`/mandates?edit=${m.id}`}>{m.title}</Link>
                      <div className="meta"><LineBadge line={m.line} />{!m.active && <span className="badge">Switched off</span>}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
