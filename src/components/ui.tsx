import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { GATE_LABEL, LINE_LABEL, MATCH_STATUS_LABEL, SANCTIONS_LABEL, SCORE_PARTS } from "../lib/labels.ts";
import { fmtNumber, hostOf, safeHref } from "../lib/format.ts";
import { friendlyError, isNotAllowed } from "../lib/rules.ts";

export const NOT_APPROVED = "This account isn't approved for the Nodus console.";

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Nodus` : "Nodus Origination";
  }, [title]);
}

export function Empty({ children }: { children?: ReactNode }) {
  return <p className="empty">{children ?? "Nothing yet — the engine runs every morning."}</p>;
}

export function Loading({ what = "Loading…" }: { what?: string }) {
  return <p className="loading muted" role="status">{what}</p>;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="card stack" role="alert">
      <h2>{isNotAllowed(error) ? "Not approved" : "Something went wrong"}</h2>
      <p className="muted">{isNotAllowed(error) ? NOT_APPROVED : friendlyError(error)}</p>
      {onRetry && (
        <div>
          <button className="btn" onClick={onRetry}>Try again</button>
        </div>
      )}
    </div>
  );
}

export function NotFound({ what = "record" }: { what?: string }) {
  useTitle("Not found");
  return (
    <div className="card stack">
      <h1>Not found</h1>
      <p className="muted">That {what} does not exist (it may have been merged or removed).</p>
      <Link to="/">Back to Today</Link>
    </div>
  );
}

export function LineBadge({ line }: { line: string | null }) {
  return <span className={`badge line-${line ?? "other"}`}>{line ? LINE_LABEL[line] ?? line : "Other"}</span>;
}

export function GateBadge({ gate }: { gate: string | null }) {
  if (!gate) return null;
  return <span className={`badge gate gate-${gate}`}>{GATE_LABEL[gate] ?? gate}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge status-${status}`}>{MATCH_STATUS_LABEL[status] ?? status}</span>;
}

export function SanctionsBadge({ status }: { status: string }) {
  return <span className={`badge sanctions-${status}`}>{SANCTIONS_LABEL[status] ?? status}</span>;
}

export function Score({ value }: { value: number }) {
  const v = Math.round(Number(value) || 0);
  const tone = v >= 75 ? "high" : v >= 55 ? "mid" : "low";
  return (
    <span className={`score score-${tone}`} title="Overall score out of 100">
      {v}
    </span>
  );
}

export function ScoreBars({ scores }: { scores: Record<string, number> | null }) {
  return (
    <dl className="bars">
      {SCORE_PARTS.map((p) => {
        const raw = Number(scores?.[p.key]);
        const v = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : null;
        return (
          <div key={p.key} className="bar-row" title={p.hint}>
            <dt>{p.label}</dt>
            <dd>
              <span className="bar-track" aria-hidden>
                <span className="bar-fill" style={{ width: `${v ?? 0}%` }} />
              </span>
              <span className="bar-num">{v === null ? "—" : fmtNumber(v)}</span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function ExtLink({ url, children }: { url: string | null | undefined; children?: ReactNode }) {
  const href = safeHref(url);
  if (!href) return <span className="muted">{children ?? "no link"}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="ext">
      {children ?? hostOf(href)}
    </a>
  );
}

export function Confidence({ value }: { value: number }) {
  const pct = Math.round((Number(value) || 0) * 100);
  return <span className="muted" title="How confident the engine is in this fact">{pct}% sure</span>;
}

/** Previous / next links that keep the current filters. */
export function Pager({
  basePath,
  params,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  params: Record<string, string | number | null | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  if (total <= pageSize) return null;
  const pages = Math.ceil(total / pageSize);
  const href = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") u.set(k, String(v));
    if (p > 1) u.set("page", String(p));
    const s = u.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  return (
    <nav className="pager" aria-label="Pages">
      {page > 1 ? <Link to={href(page - 1)}>← Previous</Link> : <span />}
      <span className="muted">
        Page {page} of {pages} · {fmtNumber(total)} in total
      </span>
      {page < pages ? <Link to={href(page + 1)}>Next →</Link> : <span />}
    </nav>
  );
}
