import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { priorityInsert, prioritySwap, priorityUpdate, type PriorityPatch } from "../lib/data.ts";
import { ASKS, priorityPrompt, type AskKey } from "../lib/focus.ts";
import { claudeLink } from "../lib/claude.ts";
import { fmtNumber } from "../lib/format.ts";
import { friendlyError } from "../lib/rules.ts";
import type { Priority, PriorityProgress } from "../lib/types.ts";
import { Icon } from "./Brand.tsx";
import { toast } from "./Toast.tsx";

/** What to tell Kuran after opening Claude. The instruction is always in the link; there is nothing to paste. */
export function claudeNote(full: boolean): string {
  return full
    ? "Opened a Nodus chat with the instruction filled in. Press send there."
    : "Opened a Nodus chat with the instruction filled in (shortened to fit; Claude looks up the rest). Press send there.";
}

/** Open a new Claude chat in the Nodus project with the instruction filled in. */
export function openInClaude(text: string): void {
  const { url, full } = claudeLink(text);
  window.open(url, "_blank", "noopener,noreferrer");
  toast(claudeNote(full));
}

/** A link that opens Claude in the Nodus project with the instruction filled in. */
export function AskClaude({ prompt, className = "btn primary big", children }: { prompt: string; className?: string; children: React.ReactNode }) {
  const { url, full } = claudeLink(prompt);
  return (
    <a
      className={className}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => toast(claudeNote(full))}
    >
      {children}
    </a>
  );
}

/** Drafts waiting, approved, sent, replied: four plain counts, the actionable one lit. */
export function ProgressStrip({ pr }: { pr: PriorityProgress | undefined }) {
  const cells = [
    { k: "drafts", n: pr?.drafts ?? 0, label: "waiting", more: " for you", hot: true },
    { k: "approved", n: (pr?.approved ?? 0) + (pr?.manual ?? 0), label: "approved" },
    { k: "sent", n: pr?.sent ?? 0, label: "sent" },
    { k: "replied", n: pr?.replied ?? 0, label: "replied" },
  ];
  return (
    <ol className="pstrip" aria-label="Progress">
      {cells.map((c) => (
        <li key={c.k} className={`${c.n > 0 ? "has" : ""}${c.hot && c.n > 0 ? " hot" : ""}`}>
          <b>{fmtNumber(c.n)}</b>
          <span>{c.label}{"more" in c && <i className="wide-only">{c.more}</i>}</span>
        </li>
      ))}
    </ol>
  );
}

interface CardProps {
  p: Priority;
  pr: PriorityProgress | undefined;
  above: Priority | null;
  below: Priority | null;
  onChanged: () => void;
}

/** One priority as a large card: what it is, how far it has got, and one obvious next action. */
export function PriorityCard({ p, pr, above, below, onChanged }: CardProps) {
  const [editing, setEditing] = useState(false);
  const drafts = (pr?.drafts ?? 0) + (pr?.manual ?? 0);
  return (
    <article className={`pcard${p.status !== "active" ? " off" : ""}`} aria-labelledby={`p-${p.id}`}>
      <div className="pcard-rank" aria-label={`Priority ${p.rank}`}>{p.rank}</div>
      <div className="pcard-body">
        <div className="pcard-head">
          <h3 id={`p-${p.id}`}>{p.title}</h3>
          <button type="button" className="icon-btn ghost" onClick={() => setEditing((v) => !v)} aria-expanded={editing} aria-label={editing ? `Close editing ${p.title}` : `Edit ${p.title}`} title="Edit">
            {editing ? <Icon.close /> : <Icon.pencil />}
          </button>
        </div>
        {p.goal && <p className="pcard-goal" title={p.goal}>{p.goal}</p>}
        {p.status !== "active" && <p className="pcard-state">{p.status === "paused" ? "Paused" : "Done"}</p>}
        {editing ? (
          <PriorityEditor p={p} above={above} below={below} onDone={() => { setEditing(false); onChanged(); }} />
        ) : (
          <>
            <ProgressStrip pr={pr} />
            {p.next_action && (
              <p className="pcard-next"><span>Next</span>{p.next_action}</p>
            )}
            {p.status === "active" && (
              <div className="pcard-actions">
                <AskClaude prompt={priorityPrompt(p)}><Icon.claude />Ask Claude</AskClaude>
                {drafts > 0 && (
                  <Link className="btn big" to={`/review?priority=${p.id}`}>Review {fmtNumber(drafts)} {drafts === 1 ? "draft" : "drafts"}</Link>
                )}
                <AskMenu p={p} />
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}

export function AskMenu({ p, extra = [] }: { p: Priority; extra?: { label: string; prompt: string }[] }) {
  return (
    <details className="ask-menu">
      <summary>Other asks</summary>
      <div className="ask-list">
        {extra.map((a) => (
          <AskClaude key={a.label} prompt={a.prompt} className="ask-item">{a.label}</AskClaude>
        ))}
        {ASKS.map((a) => (
          <AskClaude key={a.key} prompt={priorityPrompt(p, a.key as AskKey)} className="ask-item">{a.label}</AskClaude>
        ))}
      </div>
    </details>
  );
}

/** Inline editing: wording, order and status. Writes straight to the priorities table. */
export function PriorityEditor({ p, above, below, onDone }: { p: Priority; above: Priority | null; below: Priority | null; onDone: () => void }) {
  const [f, setF] = useState({ title: p.title, goal: p.goal ?? "", who: p.who ?? "", next_action: p.next_action ?? "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (what: string, fn: () => Promise<void>, done: string) => {
    setBusy(what);
    setErr(null);
    try {
      await fn();
      toast(done);
      onDone();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) return setErr("Give the priority a title.");
    const patch: PriorityPatch = {
      title: f.title.trim(),
      goal: f.goal.trim() || null,
      who: f.who.trim() || null,
      next_action: f.next_action.trim() || null,
    };
    void run("save", () => priorityUpdate(p.id, patch), "Priority saved.");
  };
  const status = (s: Priority["status"], msg: string) => run(s, () => priorityUpdate(p.id, { status: s }), msg);
  return (
    <form className="peditor" onSubmit={save}>
      <label className="field"><span>Title</span><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={160} required /></label>
      <label className="field"><span>Goal: what closed looks like</span><input value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} maxLength={300} /></label>
      <label className="field"><span>Who we need</span><input value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })} maxLength={300} /></label>
      <label className="field"><span>Next action</span><textarea rows={2} value={f.next_action} onChange={(e) => setF({ ...f, next_action: e.target.value })} maxLength={500} /></label>
      <div className="action-row">
        <button className="btn primary" type="submit" disabled={Boolean(busy)}>{busy === "save" ? "Saving…" : "Save"}</button>
        {above && p.status === "active" && (
          <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => run("up", () => prioritySwap(p, above), "Moved up.")}><Icon.up />Move up</button>
        )}
        {below && p.status === "active" && (
          <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => run("down", () => prioritySwap(p, below), "Moved down.")}><Icon.down />Move down</button>
        )}
      </div>
      <div className="action-row">
        {p.status === "active" ? (
          <>
            <button className="btn ghost" type="button" disabled={Boolean(busy)} onClick={() => status("paused", "Paused. It is under Priorities if you want it back.")}>Pause</button>
            <button className="btn ghost" type="button" disabled={Boolean(busy)} onClick={() => status("done", "Marked done.")}>Mark done</button>
          </>
        ) : (
          <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => status("active", "Back on your list.")}>Make active again</button>
        )}
      </div>
      {err && <p className="error small" role="alert">{err}</p>}
    </form>
  );
}

/** "Add a priority": a short form; the new one goes to the bottom of the list. */
export function AddPriority({ nextRank, onAdded }: { nextRank: number; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", goal: "", who: "", next_action: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open) {
    return <button type="button" className="padd" onClick={() => setOpen(true)}>+ Add a priority</button>;
  }
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) return setErr("Give the priority a title.");
    setBusy(true);
    setErr(null);
    try {
      await priorityInsert({ title: f.title.trim(), goal: f.goal.trim() || null, who: f.who.trim() || null, next_action: f.next_action.trim() || null, rank: nextRank });
      toast("Priority added.");
      setF({ title: "", goal: "", who: "", next_action: "" });
      setOpen(false);
      onAdded();
    } catch (e2) {
      setErr(friendlyError(e2));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="pcard padd-form" onSubmit={save} aria-label="Add a priority">
      <div className="pcard-rank" aria-hidden>{nextRank}</div>
      <div className="pcard-body peditor">
        <label className="field"><span>Title</span><input autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={160} placeholder="What are we trying to close?" /></label>
        <label className="field"><span>Goal: what closed looks like</span><input value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} maxLength={300} /></label>
        <label className="field"><span>Who we need</span><input value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })} maxLength={300} /></label>
        <label className="field"><span>Next action</span><textarea rows={2} value={f.next_action} onChange={(e) => setF({ ...f, next_action: e.target.value })} maxLength={500} /></label>
        <div className="action-row">
          <button className="btn primary" type="submit" disabled={busy}>{busy ? "Adding…" : "Add priority"}</button>
          <button className="btn ghost" type="button" onClick={() => setOpen(false)}>Cancel</button>
        </div>
        {err && <p className="error small" role="alert">{err}</p>}
      </div>
    </form>
  );
}
