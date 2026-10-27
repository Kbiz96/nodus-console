import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { MATCH_CARD_COLS, activeMandateFilter, inactiveMandateIds } from "../lib/data.ts";
import { useLoad } from "../lib/useLoad.ts";
import { fmtDate, fmtNumber } from "../lib/format.ts";
import { feedbackLine } from "../lib/feedback.ts";
import { buildGraph, clip, curve, linkStyle, type GNode } from "../lib/graph.ts";
import { LINES, LINE_LABEL, lineColour } from "../lib/labels.ts";
import type { MatchCardRow } from "../lib/types.ts";
import MatchActions from "../components/MatchActions.tsx";
import { SelectionBar, SeqActions, StageChip } from "../components/Sequencer.tsx";
import BestNext from "../components/BestNext.tsx";
import { ALL_STAGES, STAGES, STAGE_COLOUR, STAGE_LABEL, type SeqOpp, type Stage } from "../lib/sequencer.ts";
import { stagesFor } from "../lib/sequencer-data.ts";
import { shownStage, useSeqState } from "../lib/stageStore.ts";
import { EngineTabs } from "../components/EngineTabs.tsx";
import { Empty, ErrorBox, ExtLink, GateBadge, LineBadge, Loading, PageHead, ScoreBars, StatusBadge, Swatch, useTitle } from "../components/ui.tsx";

const LOAD_CAP = 400;
const TOPS = [30, 60, 120] as const;
const VIEWS = [
  { key: "open", label: "Open", statuses: ["proposed", "shortlisted"] },
  { key: "shortlisted", label: "Shortlisted", statuses: ["shortlisted"] },
  { key: "all", label: "All but rejected", statuses: ["proposed", "shortlisted", "sent_to_crm"] },
] as const;

async function load(statuses: readonly string[]) {
  // Matches on switched-off mandates are hidden (they also stay out of the mandate list below).
  const keep = activeMandateFilter(await inactiveMandateIds());
  let q = supabase.from("v_match_cards").select(MATCH_CARD_COLS).in("status", statuses as string[]);
  if (keep) q = q.or(keep);
  const rows = must(
    await q
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
  const best = sp.get("best") === "1";
  const stageParam = sp.get("stage");
  const stageSel = (ALL_STAGES as readonly string[]).includes(stageParam ?? "") ? (stageParam as Stage) : null;
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== "m") n.delete("m");
    setSp(n, { replace: true });
  };

  const { data, error, loading, reload } = useLoad(() => load(view.statuses), view.key);
  const oppIds = useMemo(() => [...new Set((data ?? []).flatMap((r) => [r.supply_id, r.need_id]).filter(Boolean))] as string[], [data]);
  const { data: stages, reload: reloadStages } = useLoad(() => stagesFor(oppIds), `stages:${oppIds.length}:${oppIds[0] ?? ""}`);
  const seq = useSeqState();
  const stageOf = (id: string | null | undefined): Stage => (id ? shownStage(seq, id, stages?.get(id)) : "found");
  const [picked, setPicked] = useState<Map<string, SeqOpp>>(() => new Map());
  const togglePick = (o: SeqOpp) => setPicked((p) => {
    const n = new Map(p);
    if (n.has(o.id)) n.delete(o.id);
    else n.set(o.id, o);
    return n;
  });
  const pickedOpps = [...picked.values()].map((o) => ({ ...o, stage: stageOf(o.id) }));
  const changed = () => {
    reload();
    reloadStages();
  };

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
    if (stageSel) rows = rows.filter((r) => [r.supply_id, r.need_id].some((id) => id && stageOf(id) === stageSel));
    return rows.slice(0, top);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, line, allLines, mandate, top, stageSel, stages, seq]);
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
        actions={<EngineTabs />}
      >
        {best
          ? "The 20 opportunities most worth working, routed to a mandate first. Work them top-down: one click takes each to drafted."
          : "Mandates and needs on the left, opportunities on the right. Each line is a match; thicker and brighter means a higher score. Tick opportunities on the right to work several at once."}
      </PageHead>

      {best ? (
        <BestNext />
      ) : (
      <>
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
        <label className="field">
          <span>Stage</span>
          <select value={stageSel ?? ""} onChange={(e) => set("stage", e.target.value || null)}>
            <option value="">Any stage</option>
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            <option value="dismissed">Dismissed</option>
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
              <Board graph={graph} selId={selected?.id ?? null} onPick={pick} stageOf={stageOf} picked={picked} onToggle={togglePick} />
            </div>
            <div className="legend-lines" aria-label="Line colours">
              {LINES.map((l) => (
                <span key={l}><i style={{ background: lineColour(l) }} />{LINE_LABEL[l]}</span>
              ))}
              <span>Ring on the right: stage ({STAGES.filter((s) => s !== "found").map((s) => STAGE_LABEL[s].toLowerCase()).join(", ")}). Faded: dismissed.</span>
              <span><Swatch colour="var(--teal)" />Mandate card</span>
              <span>Square on the left is a mandate; a diamond is a need without one.</span>
            </div>
          </div>

          <aside className="engine-panel" ref={panelRef} aria-live="polite">
            {selected ? (
              <Breakdown m={selected} onChanged={changed} onClose={() => set("m", null)} stageOf={stageOf} />
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
      {pickedOpps.length > 0 && (
        <div className="seq-sticky">
          <SelectionBar opps={pickedOpps} onClear={() => setPicked(new Map())} onChanged={changed} />
        </div>
      )}
      </>
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

function Board({ graph, selId, onPick, stageOf, picked, onToggle }: {
  graph: ReturnType<typeof buildGraph>;
  selId: string | null;
  onPick: (id: string) => void;
  stageOf: (id: string) => Stage;
  picked: Map<string, SeqOpp>;
  onToggle: (o: SeqOpp) => void;
}) {
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
    const isOpp = n.kind === "opportunity";
    const st = isOpp ? stageOf(n.id) : "found";
    const pickable = side === "R" && isOpp;
    const on = pickable && picked.has(n.id);
    const cls = `node node-${side.toLowerCase()}${hl ? (hl.nodes.has(key) ? " hl" : " dim") : ""}${st === "dismissed" ? " dismissed" : ""}${on ? " picked" : ""}`;
    const best = graph.links.filter((k) => (side === "L" ? k.left : k.right) === n.key).sort((a, b) => b.score - a.score)[0];
    const label = clip(n.label, pickable ? Math.max(6, maxChars - 3) : maxChars);
    const c = n.kind === "mandate" ? "var(--teal)" : lineColour(n.line);
    const sz = Math.min(9, 4 + Math.sqrt(n.degree) * 1.6);
    return (
      <g
        key={key}
        className={cls}
        onMouseEnter={() => setHover(n.key)}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          if (pickable && (e.shiftKey || e.metaKey)) onToggle({ id: n.id, title: n.label });
          else if (best) onPick(best.match.id);
        }}
      >
        <title>{`${n.label} — ${n.degree} match${n.degree === 1 ? "" : "es"}${isOpp ? `, ${STAGE_LABEL[st].toLowerCase()}` : ""}`}</title>
        <rect className="hit" x={side === "L" ? 0 : xR - 6} y={yy - rowH / 2} width={labW + 16} height={rowH} />
        {side === "L" ? (
          n.kind === "mandate" ? (
            <rect x={xL - sz / 2} y={yy - sz / 2} width={sz} height={sz} fill={c} />
          ) : (
            <rect x={xL - sz / 2} y={yy - sz / 2} width={sz} height={sz} fill="none" stroke={c} strokeWidth={1.3} transform={`rotate(45 ${xL} ${yy})`} />
          )
        ) : (
          <>
            {st !== "found" && st !== "dismissed" && <circle className="stage-ring" cx={xR} cy={yy} r={sz / 2 + 3} stroke={STAGE_COLOUR[st]} />}
            <circle cx={xR} cy={yy} r={sz / 2 + 0.5} fill={c} />
          </>
        )}
        {side === "L" && isOpp && st !== "found" && st !== "dismissed" && (
          <rect className="stage-ring" x={xL - sz / 2 - 3} y={yy - sz / 2 - 3} width={sz + 6} height={sz + 6} stroke={STAGE_COLOUR[st]} transform={n.kind === "opportunity" ? `rotate(45 ${xL} ${yy})` : undefined} />
        )}
        <text x={side === "L" ? xL - 10 : xR + 10} y={yy + 3.5}>{label}</text>
        {pickable && (
          <rect
            className={`pickbox${on ? " on" : ""}`}
            x={W - 15}
            y={yy - 5.5}
            width={11}
            height={11}
            role="checkbox"
            aria-checked={on}
            aria-label={`Select ${n.label}`}
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onToggle({ id: n.id, title: n.label });
            }}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                onToggle({ id: n.id, title: n.label });
              }
            }}
          />
        )}
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

function Breakdown({ m, onChanged, onClose, stageOf }: { m: MatchCardRow; onChanged: () => void; onClose: () => void; stageOf: (id: string) => Stage }) {
  const sides = [
    m.supply_id ? { id: m.supply_id, title: m.supply_title, tag: "Supply" } : null,
    m.need_id ? { id: m.need_id, title: m.need_title, tag: "Need" } : null,
  ].filter((x): x is { id: string; title: string | null; tag: string } => Boolean(x));
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
      </ul>
      {sides.map((s) => (
        <div key={s.id} className="side-seq" aria-label={`${s.tag}: next stage`}>
          <div className="side-seq-head">
            <span className="side-tag">{s.tag}</span>
            <Link to={`/opportunities/${s.id}`}>{s.title}</Link>
            <GateBadge gate={s.tag === "Supply" ? m.supply_gate : m.need_gate} />
          </div>
          <StageChip id={s.id} stage={stageOf(s.id)} />
          <SeqActions opps={[{ id: s.id, title: s.title, stage: stageOf(s.id) }]} small onChanged={onChanged} />
        </div>
      ))}
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
      {sides.length > 1 && (
        <div className="enrich-cta">
          <SeqActions opps={sides.map((s) => ({ id: s.id, title: s.title, stage: stageOf(s.id) }))} bulk onChanged={onChanged} />
          <span className="muted small">Both sides in one Claude chat: research, people, first-touch email drafts. Nothing is sent until you approve it.</span>
        </div>
      )}
      <MatchActions key={m.id} id={m.id} status={m.status} onChanged={onChanged} />
    </article>
  );
}
