import { useEffect, useMemo, useState } from "react";
import { useCached } from "../lib/cache.ts";
import {
  KIND_LABEL, groupRows, isHttps, learningData, learningList, markdownToHtml, pillarLabel, sanitiseHtml, searchRows,
  type LearningData, type LearningRow, type QuizQ,
} from "../lib/learning.ts";
import { remember } from "../lib/calm.ts";
import { ErrorBox, Loading } from "./ui.tsx";

const SORT_KEY = "nodus-learning-sort";

function fmtDay(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** Sanitised HTML. Every string passed here goes through the allow-list first. */
function Html({ html, className = "lib-body" }: { html: string | undefined; className?: string }) {
  const clean = useMemo(() => sanitiseHtml(html ?? ""), [html]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />;
}

/**
 * Learning library: every past lesson, course module and learning document, untimed. Pick one to read it; the quiz
 * is a self-check (pick an answer, see why), with no score or timer.
 */
export default function LearningLibrary() {
  const list = useCached(learningList, "learning:list", 60 * 60 * 1000);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"newest" | "module">(() => (remember(SORT_KEY) === "module" ? "module" : "newest"));
  const [open, setOpen] = useState<LearningRow | null>(null);

  const rows = list.data ?? [];
  const groups = useMemo(() => groupRows(searchRows(rows, q), sort), [rows, q, sort]);
  const shown = groups.reduce((n, g) => n + g.rows.length, 0);
  const setSortBoth = (s: "newest" | "module") => { setSort(s); remember(SORT_KEY, s); };

  if (open) return <LessonView row={open} onBack={() => setOpen(null)} />;

  return (
    <div className="lib">
      <div className="lib-tools">
        <input type="search" className="lib-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lessons, modules, topics" aria-label="Search the learning library" />
        <div className="lib-sort" role="group" aria-label="Sort">
          <button type="button" className={`btn small${sort === "newest" ? " on" : ""}`} aria-pressed={sort === "newest"} onClick={() => setSortBoth("newest")}>Newest first</button>
          <button type="button" className={`btn small${sort === "module" ? " on" : ""}`} aria-pressed={sort === "module"} onClick={() => setSortBoth("module")}>By pillar and module</button>
        </div>
      </div>
      {list.error && !list.data ? (
        <ErrorBox error={list.error} onRetry={list.reload} />
      ) : list.loading && !list.data ? (
        <Loading what="Getting your lessons…" />
      ) : rows.length === 0 ? (
        <p className="muted small">No lessons in the library yet.</p>
      ) : shown === 0 ? (
        <p className="muted small">Nothing matches “{q}”.</p>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="lib-group" aria-label={g.label}>
            <h3 className="lib-group-h">{g.label} <span className="muted small">{g.rows.length}</span></h3>
            <ul className="lib-list">
              {g.rows.map((r) => (
                <li key={r.id}>
                  <button type="button" className="lib-item" onClick={() => { setOpen(r); window.scrollTo({ top: document.getElementById("learning")?.offsetTop ?? 0 }); }}>
                    <span className="lib-item-meta">
                      {r.lesson_date ? `${fmtDay(r.lesson_date)}${r.slot ? ` · ${r.slot === "am" ? "Morning" : r.slot === "pm" ? "Evening" : r.slot}` : ""}` : KIND_LABEL[r.kind] ?? r.kind}
                      {sort === "newest" && r.pillar ? ` · ${pillarLabel(r.pillar)}` : ""}
                    </span>
                    <span className="lib-item-title">{r.title}</span>
                    {r.summary && <span className="lib-item-sum">{r.summary}</span>}
                    {sort === "module" && r.module && <span className="lib-item-meta">{r.module}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function LessonView({ row, onBack }: { row: LearningRow; onBack: () => void }) {
  const [data, setData] = useState<LearningData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    learningData(row.id).then((d) => { if (live) setData(d); }, (e) => { if (live) setError(e); });
    return () => { live = false; };
  }, [row.id, tick]);

  return (
    <article className="lib-lesson">
      <button type="button" className="net-link" onClick={onBack}>← All lessons</button>
      <p className="lib-item-meta">
        {[row.lesson_date ? fmtDay(row.lesson_date) : KIND_LABEL[row.kind], pillarLabel(row.pillar), row.module].filter(Boolean).join(" · ")}
      </p>
      <h3 className="lib-title">{row.title}</h3>
      {row.summary && <p className="lib-sum">{row.summary}</p>}
      {error ? <ErrorBox error={error} onRetry={() => setTick((t) => t + 1)} /> : !data ? <Loading what="Opening the lesson…" /> : <LessonBody row={row} d={data} />}
    </article>
  );
}

function LessonBody({ row, d }: { row: LearningRow; d: LearningData }) {
  if (row.kind === "doc") return <Html html={markdownToHtml(d.markdown ?? "")} />;
  return (
    <>
      {d.story?.headline && (
        <div className="lib-story">
          <span className="eyebrow small">News story{d.story.published ? ` · ${d.story.published}` : ""}</span>
          <strong>{d.story.headline}</strong>
          {isHttps(d.story.url) && <a href={d.story.url} target="_blank" rel="noopener noreferrer">Read on {d.story.source || "DCD"}</a>}
        </div>
      )}
      {(d.sections ?? []).map((s, i) => (
        <section key={i} className={`lib-sec${/numbers/i.test(s.h ?? "") ? " is-numbers" : ""}`}>
          {s.h && <h4>{s.h}</h4>}
          <Html html={s.body} />
        </section>
      ))}
      {(d.lessons ?? []).map((l, i) => (
        <section key={i} className="lib-sec">
          <h4>{i + 1}. {l.t}</h4>
          <Html html={l.h} />
        </section>
      ))}
      {d.nodus && (d.nodus.line || d.nodus.ask || d.nodus.redflag || d.nodus.signal) && (
        <aside className="lib-nodus" aria-label="How you use this at Nodus">
          <span className="eyebrow small">How you use this at Nodus</span>
          <dl>
            {d.nodus.line && <div><dt>Say it on a call</dt><dd>{d.nodus.line}</dd></div>}
            {d.nodus.ask && <div><dt>Ask</dt><dd>{d.nodus.ask}</dd></div>}
            {d.nodus.redflag && <div><dt>Red flag</dt><dd>{d.nodus.redflag}</dd></div>}
            {d.nodus.signal && <div><dt>Prospect signal (internal)</dt><dd>{d.nodus.signal}</dd></div>}
          </dl>
        </aside>
      )}
      {d.drill?.prompt && <Drill kind={d.drill.kind} prompt={d.drill.prompt} model={d.drill.model} />}
      {(d.quiz?.length ?? 0) > 0 && <SelfCheck title="Self-check" qs={d.quiz ?? []} />}
      {(d.exam?.length ?? 0) > 0 && <SelfCheck title="Self-check questions" qs={d.exam ?? []} />}
      {(d.sources?.length ?? 0) > 0 && (
        <p className="lib-sources small">
          Sources:{" "}
          {(d.sources ?? []).map((s, i) => (
            <span key={i}>
              {i > 0 && " · "}
              {isHttps(s.u) ? <a href={s.u} target="_blank" rel="noopener noreferrer">{s.t || s.u}</a> : s.t}
            </span>
          ))}
        </p>
      )}
    </>
  );
}

function Drill({ kind, prompt, model }: { kind?: string; prompt: string; model?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <section className="lib-drill">
      <span className="eyebrow small">Practice{kind ? ` · ${kind}` : ""}</span>
      <Html html={prompt} />
      {model && (
        <>
          <button type="button" className="btn small" aria-expanded={shown} onClick={() => setShown(!shown)}>{shown ? "Hide model answer" : "Show model answer"}</button>
          {shown && <Html html={model} className="lib-body lib-model" />}
        </>
      )}
    </section>
  );
}

/** Pick an option to see the answer and why. Nothing is scored, timed or saved. */
function SelfCheck({ title, qs }: { title: string; qs: QuizQ[] }) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  return (
    <section className="lib-quiz">
      <div className="lib-quiz-head">
        <h4>{title}</h4>
        {Object.keys(picked).length > 0 && <button type="button" className="net-link" onClick={() => setPicked({})}>Clear my answers</button>}
      </div>
      <ol className="lib-qs">
        {qs.map((q, i) => {
          const p = picked[i];
          const answered = p !== undefined;
          return (
            <li key={i} className="lib-q">
              <p className="lib-q-text">{q.q}</p>
              <div className="lib-opts">
                {q.o.map((o, j) => (
                  <button
                    key={j}
                    type="button"
                    className={`lib-opt${answered && j === q.a ? " is-right" : ""}${answered && j === p && p !== q.a ? " is-picked" : ""}`}
                    disabled={answered}
                    onClick={() => setPicked({ ...picked, [i]: j })}
                  >
                    <span className="lib-opt-k" aria-hidden>{"ABCDEFG"[j]}</span>{o}
                  </button>
                ))}
              </div>
              {answered && (
                <p className="lib-why" role="status">
                  <strong>{p === q.a ? "Yes." : `The answer is ${"ABCDEFG"[q.a]}.`}</strong> {q.why}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
