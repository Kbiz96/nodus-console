import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { Filters } from "../lib/filters.ts";
import { hrefWith } from "../lib/filters.ts";
import { GATES, GATE_LABEL, LINES, LINE_LABEL, MATCH_STATUSES, MATCH_STATUS_LABEL } from "../lib/labels.ts";

type Field = "q" | "line" | "country" | "dates" | "mw" | "side" | "status" | "source" | "gate";

/** Filters are kept in the address, so the back button and bookmarks work. */
export default function FilterBar({
  path,
  filters,
  fields,
  hidden = {},
  sources = [],
  qPlaceholder = "Words to look for",
}: {
  path: string;
  filters: Filters;
  fields: Field[];
  hidden?: Record<string, string | null>;
  sources?: { id: string; name: string }[];
  qPlaceholder?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const has = (f: Field) => fields.includes(f);
  const moreActive = Boolean(
    (has("line") && filters.line) || (has("side") && filters.side) || (has("status") && filters.status) ||
      (has("gate") && filters.gate) || (has("source") && filters.source) || (has("country") && filters.country) ||
      (has("mw") && filters.minMw) || (has("dates") && (filters.from || filters.to)),
  );
  const clearHref = hrefWith(path, hidden);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(hidden)) if (v) params[k] = v;
    for (const [k, v] of data.entries()) if (typeof v === "string" && v.trim()) params[k] = v.trim();
    navigate(hrefWith(path, params));
  };

  return (
    <form onSubmit={submit} className="filters" key={location.search}>
      {has("q") && (
        <label className="field grow">
          <span>Search</span>
          <input type="search" name="q" defaultValue={filters.q} placeholder={qPlaceholder} />
        </label>
      )}
      <details className="more-filters" open={moreActive}>
        <summary>More filters{moreActive ? " (in use)" : ""}</summary>
        <div className="more-grid">
          {has("line") && (
            <label className="field">
              <span>Line</span>
              <select name="line" defaultValue={filters.line ?? ""}>
                <option value="">All lines</option>
                {LINES.map((l) => (
                  <option key={l} value={l}>{LINE_LABEL[l]}</option>
                ))}
              </select>
            </label>
          )}
          {has("side") && (
            <label className="field">
              <span>Supply or need</span>
              <select name="side" defaultValue={filters.side ?? ""}>
                <option value="">Both</option>
                <option value="supply">Supply (has something)</option>
                <option value="need">Need (looking for something)</option>
              </select>
            </label>
          )}
          {has("status") && (
            <label className="field">
              <span>Status</span>
              <select name="status" defaultValue={filters.status ?? ""}>
                <option value="">Any status</option>
                {MATCH_STATUSES.map((s) => (
                  <option key={s} value={s}>{MATCH_STATUS_LABEL[s]}</option>
                ))}
              </select>
            </label>
          )}
          {has("gate") && (
            <label className="field">
              <span>Step</span>
              <select name="gate" defaultValue={filters.gate ?? ""}>
                <option value="">Any step</option>
                {GATES.map((g) => (
                  <option key={g} value={g}>{GATE_LABEL[g]}</option>
                ))}
              </select>
            </label>
          )}
          {has("source") && (
            <label className="field">
              <span>Source</span>
              <select name="source" defaultValue={filters.source ?? ""}>
                <option value="">All sources</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>{s.name.length > 60 ? `${s.name.slice(0, 59)}…` : s.name}</option>
                ))}
              </select>
            </label>
          )}
          {has("country") && (
            <label className="field narrow">
              <span>Country</span>
              <input name="country" defaultValue={filters.country ?? ""} placeholder="e.g. GB" maxLength={2} autoCapitalize="characters" />
            </label>
          )}
          {has("mw") && (
            <label className="field narrow">
              <span>Min MW</span>
              <input name="mw" type="number" min="0" step="any" inputMode="decimal" defaultValue={filters.minMw ?? ""} />
            </label>
          )}
          {has("dates") && (
            <>
              <label className="field">
                <span>Found from</span>
                <input name="from" type="date" defaultValue={filters.from ?? ""} />
              </label>
              <label className="field">
                <span>Found to</span>
                <input name="to" type="date" defaultValue={filters.to ?? ""} />
              </label>
            </>
          )}
        </div>
      </details>
      <div className="filter-actions">
        <button className="btn primary" type="submit">Apply</button>
        <Link to={clearHref} className="btn ghost">Clear</Link>
      </div>
    </form>
  );
}
