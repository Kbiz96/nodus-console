import { useState } from "react";
import { supabase, must } from "../lib/supabase.ts";
import { useLoad } from "../lib/useLoad.ts";
import { friendlyError } from "../lib/rules.ts";
import { isOpenQuestion, withAnswer } from "../lib/today.ts";
import { toast } from "./Toast.tsx";

interface Question { id: string; title: string | null; detail: string | null; category: string | null; status: string | null; deal_id: string | null; created_at: string }

async function loadQuestions(): Promise<Question[]> {
  const rows = must(
    await supabase.from("crm_actions").select("id,title,detail,category,status,deal_id,created_at")
      .ilike("category", "question").order("created_at", { ascending: false }).limit(50),
  ) as unknown as Question[];
  return rows.filter(isOpenQuestion);
}

/** Saving an answer closes the question and writes the answer onto it and, when it belongs to a deal, onto the deal's notes. */
async function answerQuestion(q: Question, answer: string): Promise<void> {
  const now = new Date();
  must(await supabase.from("crm_actions").update({ status: "done", detail: withAnswer(q.detail, answer, now), updated_at: now.toISOString() }).eq("id", q.id).select("id"));
  if (q.deal_id) {
    const d = must(await supabase.from("deals").select("notes").eq("id", q.deal_id).maybeSingle()) as { notes: string | null } | null;
    if (d) must(await supabase.from("deals").update({ notes: withAnswer(d.notes, answer, now), updated_at: now.toISOString() }).eq("id", q.deal_id).select("id"));
  }
}

/** Today: questions Claude or the engine left for Kuran (crm_actions, category 'question'), newest first, answered inline. */
export function Questions() {
  const { data, error, loading, reload } = useLoad(loadQuestions, "questions");
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const rows = (data ?? []).filter((q) => !gone.has(q.id));
  if (error && !data) return <p className="error small">Could not load questions: {friendlyError(error)} <button type="button" className="net-link" onClick={reload}>Try again</button></p>;
  if (loading && !data) return <p className="muted small">Checking for questions…</p>;
  if (rows.length === 0) return <p className="replies-empty">No questions waiting for you.</p>;
  return (
    <ul className="owed questions">
      {rows.map((q) => <QuestionRow key={q.id} q={q} onDone={() => setGone((g) => new Set(g).add(q.id))} />)}
    </ul>
  );
}

function QuestionRow({ q, onDone }: { q: Question; onDone: () => void }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!answer.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await answerQuestion(q, answer);
      toast(q.deal_id ? "Answer saved to the question and the deal." : "Answer saved.");
      onDone();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  const id = `q-${q.id}`;
  return (
    <li className="owed-row question-row">
      <div className="owed-what">
        <p className="owed-who"><strong>{q.title || "Question"}</strong></p>
        {q.detail && <p className="owed-sum">{q.detail}</p>}
      </div>
      <form className="question-answer" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label htmlFor={id} className="sr-only">Your answer</label>
        <textarea id={id} rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer" maxLength={2000} />
        <button type="submit" className="btn small primary" disabled={busy || !answer.trim()}>{busy ? "Saving…" : "Save answer"}</button>
      </form>
      {err && <p className="error small" role="alert">{err}</p>}
    </li>
  );
}
