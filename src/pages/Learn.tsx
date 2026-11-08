import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLoad } from "../lib/useLoad.ts";
import { supabase, must } from "../lib/supabase.ts";
import { ukToday } from "../lib/format.ts";
import { claudeUrl } from "../lib/claude.ts";
import {
  dayComplete, isDone, learnDays, mondayOf, pickDay, practicePrompt, saveLog, setDone, streak, weekDays,
  type Block, type LearnDay,
} from "../lib/learnweek.ts";
import { friendlyError } from "../lib/rules.ts";
import LearningLibrary, { LessonById } from "../components/LearningLibrary.tsx";
import { toast } from "../components/Toast.tsx";
import { ErrorBox, Loading, PageHead, useTitle } from "../components/ui.tsx";

const dayName = (d: string, style: "short" | "long" = "short") => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: style, ...(style === "long" ? { day: "numeric", month: "long" } : {}) });
};
const dayNum = (d: string) => Number(d.slice(8));
const monthShort = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-GB", { timeZone: "UTC", month: "short" });
};

/**
 * Learn (#/learn): this week's plan, one day at a time. Two short blocks a day (Know the business, about 15 minutes;
 * Operator voice, about 10) and a two-minute confidence log. Everything else is the library, folded away.
 */
export default function Learn() {
  useTitle("Learn");
  const today = ukToday();
  const { data, error, loading, reload } = useLoad(() => learnDays(today), `learn:${today}`);
  // Rows saved in this visit replace the loaded ones, so ticks show at once without a reload.
  const [saved, setSaved] = useState<Record<string, LearnDay>>({});
  const rows = useMemo(() => (data ?? []).map((r) => saved[r.day] ?? r), [data, saved]);
  const [sel, setSel] = useState<string | null>(null);
  const day = sel ?? pickDay(rows, today);
  const row = rows.find((r) => r.day === day);
  const week = day ? weekDays(mondayOf(day)) : [];
  const byDay = useMemo(() => new Map(rows.map((r) => [r.day, r])), [rows]);
  const doneThisWeek = week.filter((d) => dayComplete(byDay.get(d))).length;
  const run = streak(rows, today);

  const replace = (r: LearnDay) => setSaved((m) => ({ ...m, [r.day]: r }));

  return (
    <div className="stack-lg learn">
      <PageHead eyebrow={week.length ? `Learning · ${dayNum(week[0])}–${dayNum(week[6])} ${monthShort(week[6])}` : "Learning"} title="Learn">
        Two short blocks a day: know the business, then sound like an operator. About 25 minutes.
      </PageHead>

      {error && !data ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading what="Getting this week’s plan…" />
      ) : !row || !day ? (
        <p className="muted">No plan for this week yet. Ask Claude in the Nodus project for “next week’s learning plan”.</p>
      ) : (
        <>
          <nav className="learn-week" aria-label="This week">
            {week.map((d) => {
              const r = byDay.get(d);
              return (
                <button
                  key={d}
                  type="button"
                  className={`learn-day${d === day ? " on" : ""}${d === today ? " is-today" : ""}${dayComplete(r) ? " is-done" : ""}`}
                  aria-pressed={d === day}
                  disabled={!r}
                  onClick={() => setSel(d)}
                >
                  <span className="learn-day-n">{dayName(d)}</span>
                  <span className="learn-day-d">{dayNum(d)}</span>
                  <span className="learn-dots" aria-label={`${isDone(r, "domain") ? "Business done" : "Business to do"}, ${isDone(r, "voice") ? "voice done" : "voice to do"}`}>
                    <i className={isDone(r, "domain") ? "on" : ""} />
                    <i className={isDone(r, "voice") ? "on" : ""} />
                  </span>
                </button>
              );
            })}
          </nav>
          <p className="muted small learn-tally">
            {doneThisWeek} of 7 days done this week{run > 1 ? ` · ${run} days in a row` : ""}
          </p>

          <DayPlan key={row.day} row={row} today={today} onSaved={replace} />
        </>
      )}

      <details className="learn-lib" id="learning">
        <summary>All lessons and modules</summary>
        <LearningLibrary />
      </details>
    </div>
  );
}

function DayPlan({ row, today, onSaved }: { row: LearnDay; today: string; onSaved: (r: LearnDay) => void }) {
  const label = row.day === today ? "Today" : dayName(row.day, "long");
  return (
    <section className="stack" aria-labelledby="h-learn-day">
      <div className="sec-title">
        <h2 id="h-learn-day">{label}</h2>
        {row.theme && <span className="muted small">{row.theme}</span>}
      </div>
      {row.domain_ref && (
        <BlockCard
          row={row}
          block="domain"
          eyebrow="Know the business · 15 min"
          title={row.domain_title ?? "Today’s lesson"}
          lessonId={row.domain_ref}
          kind="course"
          part={row.domain_part}
          onSaved={onSaved}
        />
      )}
      {row.voice_ref && <VoiceCard row={row} onSaved={onSaved} />}
      <ConfidenceLog row={row} onSaved={onSaved} />
    </section>
  );
}

function useToggle(row: LearnDay, block: Block, onSaved: (r: LearnDay) => void) {
  const [busy, setBusy] = useState(false);
  const done = isDone(row, block);
  const toggle = async () => {
    setBusy(true);
    try {
      onSaved(await setDone(row.day, block, !done));
      if (!done) toast(block === "domain" ? "Lesson done." : "Practice done.");
    } catch (e) {
      toast(friendlyError(e), false);
    } finally {
      setBusy(false);
    }
  };
  return { done, busy, toggle };
}

function DoneButton({ done, busy, onClick }: { done: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`btn${done ? " ghost" : " primary"}`} disabled={busy} onClick={onClick} aria-pressed={done}>
      {busy ? "Saving…" : done ? "Done ✓ · undo" : "Mark done"}
    </button>
  );
}

function BlockCard({ row, block, eyebrow, title, lessonId, kind, part, onSaved, summary, extra }: {
  row: LearnDay; block: Block; eyebrow: string; title: string; lessonId: string; kind: string; part?: number | null;
  onSaved: (r: LearnDay) => void; summary?: string | null; extra?: ReactNode;
}) {
  const { done, busy, toggle } = useToggle(row, block, onSaved);
  const [open, setOpen] = useState(false);
  return (
    <article className={`card learn-card${done ? " is-done" : ""}`}>
      <span className="eyebrow small">{eyebrow}</span>
      <h3 className="learn-card-t">{title}</h3>
      {summary && <p className="muted learn-card-s">{summary}</p>}
      <div className="action-row">
        <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close" : "Open"}</button>
        {extra}
        <DoneButton done={done} busy={busy} onClick={toggle} />
      </div>
      {open && (
        <div className="learn-body">
          <LessonById id={lessonId} kind={kind} part={part} />
          <div className="action-row">
            <DoneButton done={done} busy={busy} onClick={toggle} />
          </div>
        </div>
      )}
    </article>
  );
}

function VoiceCard({ row, onSaved }: { row: LearnDay; onSaved: (r: LearnDay) => void }) {
  const { data } = useLoad(
    async () => {
      const r = must(await supabase.from("learning_lessons").select("title,summary").eq("id", row.voice_ref ?? "").limit(1)) as unknown as { title: string; summary: string | null }[];
      return r[0] ?? null;
    },
    `learn:voice:${row.voice_ref}`,
  );
  const title = data?.title ?? "Operator voice";
  return (
    <BlockCard
      row={row}
      block="voice"
      eyebrow="Operator voice · 10 min"
      title={title}
      summary={data?.summary}
      lessonId={row.voice_ref as string}
      kind="lesson"
      onSaved={onSaved}
      extra={
        <a className="btn" href={claudeUrl(practicePrompt(title, data?.summary ?? null, row.theme))} target="_blank" rel="noopener noreferrer">
          Practise with Claude
        </a>
      }
    />
  );
}

function ConfidenceLog({ row, onSaved }: { row: LearnDay; onSaved: (r: LearnDay) => void }) {
  const [win, setWin] = useState(row.win ?? "");
  const [know, setKnow] = useState(row.know ?? "");
  const [ask, setAsk] = useState(row.ask ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setWin(row.win ?? ""); setKnow(row.know ?? ""); setAsk(row.ask ?? ""); }, [row.win, row.know, row.ask]);
  const dirty = win !== (row.win ?? "") || know !== (row.know ?? "") || ask !== (row.ask ?? "");
  const save = async () => {
    setBusy(true);
    try {
      onSaved(await saveLog(row.day, { win, know, ask }));
      toast("Saved.");
    } catch (e) {
      toast(friendlyError(e), false);
    } finally {
      setBusy(false);
    }
  };
  const field = (id: string, label: string, hint: string, v: string, set: (s: string) => void) => (
    <label className="learn-field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} type="text" value={v} maxLength={600} placeholder={hint} onChange={(e) => set(e.target.value)} />
    </label>
  );
  return (
    <article className="card learn-card">
      <span className="eyebrow small">Confidence log · 2 min</span>
      <p className="muted learn-card-s">Three honest lines. Small counts.</p>
      {field(`win-${row.day}`, "A win", "Yesterday, however small", win, setWin)}
      {field(`know-${row.day}`, "I can now explain", "One thing, in a sentence", know, setKnow)}
      {field(`ask-${row.day}`, "One ask I’ll make today", "Who, and what", ask, setAsk)}
      <div className="action-row">
        <button type="button" className="btn primary" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : dirty ? "Save" : "Saved"}</button>
      </div>
    </article>
  );
}
