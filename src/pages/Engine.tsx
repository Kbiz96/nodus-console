import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { MATCH_CARD_COLS } from "../lib/data.ts";
import { useLoad } from "../lib/useLoad.ts";
import { fmtDate, fmtNumber } from "../lib/format.ts";
import { feedbackLine } from "../lib/feedback.ts";
import { buildGraph, clip, curve, linkStyle, type GNode } from "../lib/graph.ts";
import { LINES, LINE_LABEL, lineColour } from "../lib/labels.ts";
import type { MatchCardRow } from "../lib/types.ts";
import MatchActions from "../components/MatchActions.tsx";
import EnrichDraft from "../components/EnrichDraft.tsx";
import { Empty, ErrorBox, ExtLink, GateBadge, LineBadge, Loading, PageHead, ScoreBars, StatusBadge, Swatch, useTitle } from "../components/ui.tsx";

const LOAD_CAP = 400;
const TOPS = [30, 60, 120] as const;
const VIEWS = [
  { key: "open", label: "Open", statuses: ["proposed", "shortlisted"] },
  { key: "shortlisted", label: "Shortlisted", statuses: ["shortlisted"] },
  { key: "all", label: "All but rejected", statuses: ["proposed", "shortlisted", "sent_to_crm"] },
] as const;

async function load(statuses: readonly string[]) {
  const rows = must(
    await supabase
      .from("v_match_cards")
      .select(MATCH_CARD_COLS)
      .in("status", statuses as string[])
      .order("total_score", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(LOAD_CAP),
  ) as unknown as MatchCardRow[];
  return rows;
}

export default function Engine() {
  useTitle("Engine");
  const [sp, setSp] = useSearchParams();
  const view = VIEWS.find((v) => v.key === sp.get("view")) ?? VIEWS[0];
  // Default: every line except critical power (not a focus line right now). "line=all" includes it.
  const lineParam = sp.get("line");
  const line = LINES.find((l) => l === lineParam) ?? null;
  const allLines = lineParam === "all";
  const mandate = sp.get("mandate");
  const top = TOPS.find((t) => String(t) === sp.get("top")) ?? 60;
  const selId = sp.get("m");
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== "m") n.delete("m");
    setSp(n, { replace: true });
  };

  const { data, error, loading, reload } = useLoad(() => load(view.statuses), view.key);

  const mandates = useMemo(() => {
    const m = new Map<string, { id: string; label: string; n: number }>();
    for (const r of data ?? []) if (r.mandate_id) {
      const x = m.get(r.mandate_id) ?? { id: r.mandate_id, label: r.mandate_label || "Mandate", n: 0 };
      x.n++;
      m.set(r.mandate_id, x);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [data]);

  const shown = useMemo(() => {
    let rows = data ?? [];
    if (line) rows = rows.filter((r) => r.line === line);
    else if (!allLines) rows = rows.filter((r) => r.line !== "critical_power");
    if (mandate) rows = rows.filter((r) => r.mandate_id === mandate);
    return rows.slice(0, top);
  }, [data, line, allLines, mandate, top]);
  const graph = useMemo(() => buildGraph(shown), [shown]);
  const selected = shown.find((r) => r.id === selId) ?? (data ?? []).find((r) => r.id === selId) ?? null;

  const panelRef = useRef<HTMLDivElement>(null);
  const pick = (id: string) => {
    set("m", id);
    if (window.matchMedia("(max-width: 1179px)").matches) setTimeout(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  };

  const avg = shown.length ? shown.reduce((a, r) => a + (Number(r.total_score) || 0), 0) / shown.length : 0;

  return (
    <div className="stack-lg">
      <PageHead
        eyebrow="Matchmaking engine"
        title="Engine"
        actions={
          <nav className="tabs" aria-label="Match views">
            <Link to="/engine" className="active" aria-current="page">Engine view</Link>
            <Link to="/matches">List</Link>
          </nav>
        }
      >
        Mandates and needs on the left, opportunities on the right. Each line is a match the engine proposed; thicker
        and brighter means a higher score. Pick a line to see why, then shortlist or reject it here.
      </PageHead>

      <div className="engine-controls">
        <div className="field">
          <span>Status</span>
          <div className="seg" role="group" aria-label="Status">
            {VIEWS.map((v) => (
              <button key={v.key} type="button" aria-pressed={v.key === view.key} onClick={() => set("view", v.key === "open" ? null : v.key)}>{v.label}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Line</span>
          <div className="seg" role="group" aria-label="Line">
            <button type="button" aria-pressed={!line && !allLines} onClick={() => set("line", null)} title="Every line except critical power">Focus lines</button>
            <button type="button" aria-pressed={allLines} onClick={() => set("line", "all")} title="Every line, including critical power">All</button>
            {LINES.map((l) => (
              <button key={l} type="button" aria-pressed={line === l} onClick={() => set("line", l)} title={LINE_LABEL[l]}>
                {l === "critical_power" ? "Power" : l === "powered_land" ? "Land" : l === "capital" ? "Capital" : "Compute"}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Mandate</span>
          <select value={mandate ?? ""} onChange={(e) => set("mandate", e.target.value || null)}>
            <option value="">All mandates and pairs</option>
            {mandates.map((m) => (
              <option key={m.id} value={m.id}>{m.label} ({m.n})</option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>Show</span>
          <div className="seg" role="group" aria-label="How many matches">
            {TOPS.map((t) => (
              <button key={t} type="button" aria-pressed={t === top} onClick={() => set("top", t === 60 ? null : String(t))}>Top {t}</button>
            ))}
          </div>
        </div>
      </div>

      {error && !data ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading what="Laying out the matches…" />
      ) : shown.length === 0 ? (
        <Empty>No matches fit these filters.</Empty>
      ) : (
        <div className="engine-layout">
          <div className="stack">
            <div className="engine-board">
              <div className="engine-cols">
                <span>Mandates and needs ({fmtNumber(graph.left.length)})</span>
                <span>{fmtNumber(graph.links.length)} matches, average {fmtNumber(avg)}</span>
                <span>Opportunities ({fmtNumber(graph.right.length)})</span>
              </div>
              <Board graph={graph} selId={selected?.id ?? null} onPick={pick} />
            </div>
            <div className="legend-lines" aria-label="Line colours">
              {LINES.map((l) => (
                <span key={l}><i style={{ background: lineColour(l) }} />{LINE_LABEL[l]}</span>
              ))}
              <span><Swatch colour="var(--teal)" />Mandate card</span>
              <span>Square on the left is a mandate; a diamond is a need without one.</span>
            </div>
          </div>

          <aside className="engine-panel" ref={panelRef} aria-live="polite">
            {selected ? (
              <Breakdown m={selected} onChanged={reload} onClose={() => set("m", null)} />
            ) : (
              <div className="card stack">
                <span className="eyebrow">Strongest pairings</span>
                <p className="muted small">Pick one to see the score breakdown and decide. Hover a node to trace its matches.</p>
              </div>
            )}
            <ol className="engine-rank" aria-label="Strongest matches">
              {shown.slice(0, 12).map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => pick(r.id)} aria-current={r.id === selected?.id}>
                    <span className="sc">{Math.round(Number(r.total_score) || 0)}</span>
                    <span>{r.thesis || "Possible match"}</span>
                  </button>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      )}
    </div>
  );
}

// ---------- the graph ----------

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(900);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function Board({ graph, selId, onPick }: { graph: ReturnType<typeof buildGraph>; selId: string | null; onPick: (id: string) => void }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null); // node key or "l:<match id>"
  const phone = W < 560;
  const rowH = phone ? 19 : 17;
  const pad = 14;
  const rows = Math.max(graph.left.length, graph.right.length, 6);
  const H = rows * rowH + pad * 2;
  const labW = Math.max(96, Math.min(270, W * (phone ? 0.31 : 0.29)));
  const xL = labW + 10;
  const xR = W - labW - 10;
  const charW = 6.35;
  const maxChars = Math.max(8, Math.floor((labW - 14) / charW));
  const y = (n: GNode) => pad + n.y * (H - pad * 2);
  const L = new Map(graph.left.map((n) => [n.key, n]));
  const R = new Map(graph.right.map((n) => [n.key, n]));

  const hl = useMemo(() => {
    if (!hover) return null;
    const nodes = new Set<string>();
    const links = new Set<string>();
    for (const k of graph.links) {
      const hit = hover === `l:${k.match.id}` || k.left === hover || k.right === hover;
      if (hit) {
        links.add(k.match.id);
        nodes.add(`L${k.left}`);
        nodes.add(`R${k.right}`);
      }
    }
    return { nodes, links };
  }, [hover, graph]);

  const firstPaint = useRef(true);
  useEffect(() => {
    firstPaint.current = false;
  }, []);

  const node = (n: GNode, side: "L" | "R") => {
    const yy = y(n);
    const key = `${side}${n.key}`;
    const cls = `node node-${side.toLowerCase()}${hl ? (hl.nodes.has(key) ? " hl" : " dim") : ""}`;
    const best = graph.links.filter((k) => (side === "L" ? k.left : k.right) === n.key).sort((a, b) => b.score - a.score)[0];
    const label = clip(n.label, maxChars);
    const c = n.kind === "mandate" ? "var(--teal)" : lineColour(n.line);
    const sz = Math.min(9, 4 + Math.sqrt(n.degree) * 1.6);
    return (
      <g
        key={key}
        className={cls}
        onMouseEnter={() => setHover(n.key)}
        onMouseLeave={() => setHover(null)}
        onClick={() => best && onPick(best.match.id)}
      >
        <title>{`${n.label} — ${n.degree} match${n.degree === 1 ? "" : "es"}`}</title>
        <rect className="hit" x={side === "L" ? 0 : xR - 6} y={yy - rowH / 2} width={labW + 16} height={rowH} />
        {side === "L" ? (
          n.kind === "mandate" ? (
            <rect x={xL - sz / 2} y={yy - sz / 2} width={sz} height={sz} fill={c} />
          ) : (
            <rect x={xL - sz / 2} y={yy - sz / 2} width={sz} height={sz} fill="none" stroke={c} strokeWidth={1.3} transform={`rotate(45 ${xL} ${yy})`} />
          )
        ) : (
          <circle cx={xR} cy={yy} r={sz / 2 + 0.5} fill={c} />
        )}
        <text x={side === "L" ? xL - 10 : xR + 10} y={yy + 3.5}>{label}</text>
      </g>
    );
  };

  return (
    <div ref={ref}>
      <svg className={`engine-svg${firstPaint.current ? " intro" : ""}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${graph.links.length} matches between ${graph.left.length} mandates or needs and ${graph.right.length} opportunities`}>
        <defs>
          <linearGradient id="spine" x1="0" x2="1">
            <stop offset="0" stopColor="#76B2A5" stopOpacity="0.5" />
            <stop offset="1" stopColor="#76B2A5" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={xL} x2={xL} y1={pad / 2} y2={H - pad / 2} stroke="rgba(184,196,192,.18)" />
        <line x1={xR} x2={xR} y1={pad / 2} y2={H - pad / 2} stroke="rgba(184,196,192,.18)" />
        <g>
          {graph.links.map((k, i) => {
            const a = L.get(k.left)!;
            const b = R.get(k.right)!;
            const st = linkStyle(k.score);
            const d = curve(xL + 6, y(a), xR - 6, y(b));
            const isSel = k.match.id === selId;
            const dim = hl ? !hl.links.has(k.match.id) : false;
            return (
              <g key={k.match.id}>
                <path
                  className={`link${dim ? " dim" : ""}${isSel ? " sel" : ""}`}
                  d={d}
                  pathLength={1}
                  stroke={lineColour(k.match.line)}
                  strokeWidth={isSel ? st.width + 1 : st.width}
                  strokeOpacity={hl && !dim ? Math.min(1, st.opacity + 0.3) : st.opacity}
                  style={{ animationDelay: `${Math.min(700, i * 5)}ms` }}
                />
                <path
                  className="link-hit"
                  d={d}
                  onMouseEnter={() => setHover(`l:${k.match.id}`)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onPick(k.match.id)}
                >
                  <title>{`${Math.round(k.score)} — ${k.match.thesis ?? "Possible match"}`}</title>
                </path>
              </g>
            );
          })}
        </g>
        <g>{graph.left.map((n) => node(n, "L"))}</g>
        <g>{graph.right.map((n) => node(n, "R"))}</g>
      </svg>
    </div>
  );
}

// ---------- the selected match ----------

function Breakdown({ m, onChanged, onClose }: { m: MatchCardRow; onChanged: () => void; onClose: () => void }) {
  const ex = m.explanation ?? {};
  const why = Array.isArray(ex.why) ? ex.why : [];
  const unknowns = Array.isArray(ex.unknowns) ? ex.unknowns : [];
  const evidence = Array.isArray(ex.evidence) ? ex.evidence : [];
  const learned = feedbackLine(ex.feedback);
  const whyShown = learned ? why.filter((w) => !String(w).startsWith("Down-weighted ")) : why;
  const raw = Number(ex.feedback?.raw_total);
  const adj = Math.abs(Number(ex.feedback?.adjustment));
  const total = Math.round(Number(m.total_score) || 0);
  return (
    <article className="card stack" aria-label="Selected match">
      <div className="row-between">
        <span className="eyebrow">Selected match</span>
        <button type="button" className="btn ghost small" onClick={onClose}>Close</button>
      </div>
      <div className="breakdown-total">
        <span className="big">{total}</span>
        <span className="muted small mono">/ 100 overall</span>
      </div>
      <h2><Link to={`/matches/${m.id}`}>{m.thesis || "Possible match"}</Link></h2>
      <div className="meta">
        <LineBadge line={m.line} />
        <StatusBadge status={m.status} />
        <span className="muted small">Found {fmtDate(m.created_at)}</span>
      </div>
      <ul className="sides">
        {m.mandate_label && (
          <li><span className="side-tag">Mandate</span><Link to={`/mandates?edit=${m.mandate_id}`}>{m.mandate_label}</Link></li>
        )}
        {m.supply_id && (
          <li><span className="side-tag">Supply</span><Link to={`/opportunities/${m.supply_id}`}>{m.supply_title}</Link> <GateBadge gate={m.supply_gate} /></li>
        )}
        {m.need_id && (
          <li><span className="side-tag">Need</span><Link to={`/opportunities/${m.need_id}`}>{m.need_title}</Link> <GateBadge gate={m.need_gate} /></li>
        )}
      </ul>
      <h4>Score breakdown</h4>
      <ScoreBars scores={m.scores} />
      {learned && Number.isFinite(raw) && adj > 0 && (
        <dl className="bars" aria-label="What your feedback changed">
          <div className="bar-row" title="Score before your rejections were taken into account">
            <dt>Before</dt>
            <dd>
              <span className="bar-track" aria-hidden><span className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, raw))}%` }} /></span>
              <span className="bar-num">{fmtNumber(raw)}</span>
            </dd>
          </div>
          <div className="bar-row" title="Points taken off because you rejected similar matches">
            <dt>Your feedback</dt>
            <dd>
              <span className="bar-track" aria-hidden><span className="bar-fill minus" style={{ width: `${Math.min(100, adj)}%` }} /></span>
              <span className="bar-num">−{fmtNumber(adj, adj % 1 ? 1 : 0)}</span>
            </dd>
          </div>
        </dl>
      )}
      {learned && <p className="note small">Learned from your rejections. {learned}</p>}
      <div className="match-text">
        {whyShown.length > 0 && (<><h4>Why</h4><ul>{whyShown.map((w, i) => <li key={i}>{String(w)}</li>)}</ul></>)}
        {unknowns.length > 0 && (<><h4>Unknowns</h4><ul>{unknowns.map((w, i) => <li key={i}>{String(w)}</li>)}</ul></>)}
        {ex.next_step && (<><h4>Next step</h4><p>{String(ex.next_step)}</p></>)}
      </div>
      {evidence.length > 0 && (
        <details className="evidence">
          <summary>Evidence ({evidence.length})</summary>
          <ul>
            {evidence.map((e, i) => (
              <li key={i}>
                <ExtLink url={e?.url}>{e?.title || "Source"}</ExtLink>
                {e?.quote && <blockquote>{e.quote}</blockquote>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {m.status === "rejected" && m.reject_reason && <p className="muted small">Rejected: {m.reject_reason}</p>}
      <div className="enrich-cta">
        <EnrichDraft
          opps={[m.supply_id ? { id: m.supply_id, title: m.supply_title } : null, m.need_id ? { id: m.need_id, title: m.need_title } : null].filter((x): x is { id: string; title: string | null } => Boolean(x))}
          match={m.id}
          className="btn primary"
        />
        <span className="muted small">Decision makers on both sides, then drafts for your approval.</span>
      </div>
      <MatchActions key={m.id} id={m.id} status={m.status} onChanged={onChanged} />
    </article>
  );
}
