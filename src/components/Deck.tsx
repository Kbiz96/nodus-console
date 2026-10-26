import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { useLoad } from "../lib/useLoad.ts";
import { copyNow, outreachChanged, outreachDecide, outreachMarkSent } from "../lib/data.ts";
import { DECK_STATUSES, activeInOrder, deckOrder, isLinkedIn, nextSendSlot, priorityPrompt } from "../lib/focus.ts";
import { OUTREACH_KIND_LABEL } from "../lib/crm.ts";
import { withoutParked } from "../lib/mandates.ts";
import { fmtNumber, safeHref } from "../lib/format.ts";
import { friendlyError } from "../lib/rules.ts";
import type { Outreach, Priority } from "../lib/types.ts";
import { OUTREACH_COLS } from "./TodayCrm.tsx";
import { AskClaude } from "./PriorityCard.tsx";
import { Icon } from "./Brand.tsx";
import { ErrorBox, Loading } from "./ui.tsx";
import { toast } from "./Toast.tsx";

interface Person { id: string; title: string | null; linkedin: string | null }

async function load(priorityId: string | null) {
  let q = supabase.from("outreach").select(OUTREACH_COLS).in("status", [...DECK_STATUSES]).order("created_at", { ascending: true }).limit(300);
  if (priorityId) q = q.eq("priority_id", priorityId);
  // Parked drafts never reach the deck (the status filter already leaves them out; this keeps it so).
  let rows = withoutParked(must(await q) as unknown as Outreach[]);
  if (priorityId) rows = rows.filter((r) => r.priority_id === priorityId);
  const ids = [...new Set(rows.map((r) => r.contact_id).filter(Boolean))] as string[];
  const people = new Map<string, Person>();
  if (ids.length) {
    const ps = must(await supabase.from("crm_contacts").select("id,title,linkedin").in("id", ids.slice(0, 300))) as unknown as Person[];
    for (const p of ps) people.set(p.id, p);
  }
  return { rows, people };
}

type Done = { text: string; ok: boolean };

/**
 * One draft at a time. Email: approve (the send batch sends it at the next slot), skip or edit.
 * LinkedIn: Kuran always sends it himself: copy and open the profile, then mark it sent.
 */
export default function Deck({ priorities, priorityId = null, onChanged }: { priorities: Priority[]; priorityId?: string | null; onChanged?: () => void }) {
  const { data, error, loading, reload } = useLoad(() => load(priorityId), `deck-${priorityId ?? "all"}`);
  const [queue, setQueue] = useState<string[] | null>(null);
  const [handled, setHandled] = useState(0);
  const [last, setLast] = useState<Done | null>(null);

  const byId = useMemo(() => new Map((data?.rows ?? []).map((r) => [r.id, r])), [data]);
  const prioById = useMemo(() => new Map(priorities.map((p) => [p.id, p])), [priorities]);

  // Order once per load (or when the priorities' order changes); afterwards the queue only shrinks or rotates,
  // so cards never jump about while Kuran works through them.
  const psig = priorities.map((p) => `${p.id}:${p.rank}:${p.status}`).join(",");
  const prioRef = useRef(priorities);
  prioRef.current = priorities;
  useEffect(() => {
    if (!data) return;
    setQueue(deckOrder(data.rows, prioRef.current).map((r) => r.id));
    setHandled(0);
  }, [data, psig]);

  const current = queue && queue.length ? byId.get(queue[0]) ?? null : null;
  const total = handled + (queue?.length ?? 0);

  const advance = useCallback((done: Done | null, rotate = false) => {
    setQueue((q) => (q && q.length ? (rotate ? [...q.slice(1), q[0]] : q.slice(1)) : q));
    if (!rotate) setHandled((h) => h + 1);
    setLast(done);
    if (!rotate) {
      outreachChanged();
      onChanged?.();
    }
  }, [onChanged]);

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if ((loading && !data) || !queue) return <Loading what="Getting your drafts…" />;

  if (!current) {
    const top = activeInOrder(priorities)[0];
    const filtered = priorityId ? prioById.get(priorityId) : null;
    return (
      <div className="deck-empty">
        {last && <p className={last.ok ? "ok" : "error"} role="status">{last.text}</p>}
        <h3>{handled > 0 ? "All done. Nothing else is waiting for you." : filtered ? "Nothing waiting on this priority." : "Nothing waiting for you."}</h3>
        {top && (
          <p className="muted">
            Want more? Ask Claude to find people and draft for {filtered ? "this priority" : `priority ${top.rank}`}.
          </p>
        )}
        {top && (
          <div className="action-row">
            <AskClaude prompt={priorityPrompt(filtered ?? top, "find")}><Icon.claude />Ask Claude for more</AskClaude>
            {priorityId && <Link className="btn big" to="/review">Review everything else</Link>}
          </div>
        )}
      </div>
    );
  }

  const pos = handled + 1;
  return (
    <div className="deck">
      <div className="deck-top">
        <span className="deck-count" aria-live="polite"><b>{fmtNumber(pos)}</b> of {fmtNumber(total)}</span>
        <span className="deck-keys" aria-hidden>
          {isLinkedIn(current) ? <><kbd>C</kbd> copy and open</> : <><kbd>A</kbd> approve</>} <kbd>S</kbd> skip <kbd>E</kbd> edit <kbd>L</kbd> later
        </span>
      </div>
      <div className="deck-bar" aria-hidden><span style={{ width: `${(handled / Math.max(1, total)) * 100}%` }} /></div>
      {last && <p className={`deck-last ${last.ok ? "ok" : "error"}`} role="status">{last.text}</p>}
      <DeckCard
        key={current.id}
        o={current}
        person={current.contact_id ? data?.people.get(current.contact_id) ?? null : null}
        priority={current.priority_id ? prioById.get(current.priority_id) ?? null : null}
        canLater={queue.length > 1}
        onDone={advance}
        onLater={() => advance(null, true)}
      />
    </div>
  );
}

function DeckCard({ o, person, priority, canLater, onDone, onLater }: {
  o: Outreach;
  person: Person | null;
  priority: Priority | null;
  canLater: boolean;
  onDone: (d: Done) => void;
  onLater: () => void;
}) {
  const li = isLinkedIn(o);
  const manual = o.status === "manual";
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(o.subject ?? "");
  const [body, setBody] = useState(o.body ?? "");
  const [saved, setSaved] = useState({ subject: o.subject ?? "", body: o.body ?? "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const dirty = subject !== saved.subject || body !== saved.body;
  const profile = safeHref(o.link) ?? safeHref(person?.linkedin);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const saveEdit = async () => {
    await outreachDecide(o.id, "edit", li ? o.subject : subject, body);
    setSaved({ subject, body });
  };

  const act = async (what: "approve" | "skip" | "sent" | "save") => {
    if (busy) return;
    setBusy(what);
    setErr(null);
    try {
      if (what === "save") {
        await saveEdit();
        setEditing(false);
        toast("Edit saved.");
        return;
      }
      if (dirty && !manual && what !== "skip") await saveEdit();
      if (what === "approve") {
        await outreachDecide(o.id, "approve");
        onDone({ ok: true, text: `Approved ${o.to_name ?? "the email"}. Sends at ${nextSendSlot().label}.` });
      } else if (what === "skip") {
        await outreachDecide(o.id, "skip");
        onDone({ ok: true, text: `Skipped ${o.to_name ?? "that one"}. It won't be sent.` });
      } else {
        if (!manual) await outreachDecide(o.id, "approve");
        await outreachMarkSent(o.id);
        onDone({ ok: true, text: `Marked sent to ${o.to_name ?? "them"} on LinkedIn.` });
      }
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const copyOpen = () => {
    const ok = copyNow(body);
    setCopied(true);
    toast(ok ? (profile ? "Copied. Paste it into LinkedIn, then come back and press Mark sent." : "Copied.") : "Your browser would not copy it. Select the text and copy it by hand.", ok);
    if (profile) window.open(profile, "_blank", "noopener,noreferrer");
  };

  // Keyboard on desktop: A approve, S skip, E edit, C copy (and open LinkedIn), L later.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Another list (the New leads queue) already handled this key.
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (document.querySelector(".palette")) return;
      const k = e.key.toLowerCase();
      if (k === "a" && !li) { e.preventDefault(); void act("approve"); }
      else if (k === "s" && !manual) { e.preventDefault(); void act("skip"); }
      else if (k === "e") { e.preventDefault(); setEditing(true); setTimeout(() => textRef.current?.focus(), 0); }
      else if (k === "c") { e.preventDefault(); if (li) copyOpen(); else toast(copyNow(body) ? "Copied." : "Your browser would not copy it.", true); }
      else if (k === "l" && canLater) { e.preventDefault(); onLater(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const kind = li ? (OUTREACH_KIND_LABEL[o.kind ?? ""] ?? "LinkedIn") : o.kind === "followup" ? "Follow-up email" : "Email";
  const who = o.to_name || "Unnamed recipient";
  const role = [person?.title, o.company].filter(Boolean).join(", ");

  return (
    <article className="deck-card" aria-label={`${kind} to ${who}`}>
      <div className="deck-tags">
        {priority && <span className="ptag">Priority {priority.rank}: {priority.title}</span>}
        <span className={`ctag ${li ? "li" : "em"}`}>{kind}</span>
        {manual && <span className="ctag">Approved, not sent yet</span>}
      </div>
      <div className="deck-who">
        <h3>{who}</h3>
        {role && <p>{role}</p>}
        {!li && o.to_email && <p className="mono small muted">{o.to_email}</p>}
      </div>

      {editing ? (
        <div className="deck-edit">
          {!li && (
            <label className="field"><span>Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} /></label>
          )}
          <label className="field">
            <span>Message</span>
            <textarea ref={textRef} rows={Math.min(16, Math.max(6, body.split("\n").length + 2))} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <div className="action-row">
            <button className="btn" type="button" disabled={Boolean(busy) || !dirty} onClick={() => act("save")}>{busy === "save" ? "Saving…" : "Save edit"}</button>
            <button className="btn ghost" type="button" disabled={Boolean(busy)} onClick={() => { setSubject(saved.subject); setBody(saved.body); setEditing(false); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="deck-msg">
          {!li && subject && <p className="deck-subject">{subject}</p>}
          <div className="deck-body">{body || "(no text)"}</div>
        </div>
      )}

      {o.note && <p className="deck-why"><span>Why</span>{o.note}</p>}

      <div className="deck-actions">
        {li ? (
          <>
            <button className={`btn big ${copied ? "" : "primary"}`} type="button" disabled={Boolean(busy)} onClick={copyOpen}>
              {profile ? <>Copy &amp; open LinkedIn<Icon.external /></> : "Copy message"}
            </button>
            <button className={`btn big ${copied ? "primary" : ""}`} type="button" disabled={Boolean(busy)} onClick={() => act("sent")}>
              {busy === "sent" ? "Saving…" : "Mark sent"}
            </button>
          </>
        ) : (
          <button className="btn big primary" type="button" disabled={Boolean(busy)} onClick={() => act("approve")}>
            {busy === "approve" ? "Approving…" : dirty ? "Save, approve & send" : "Approve & send"}
          </button>
        )}
        {!manual && (
          <button className="btn big" type="button" disabled={Boolean(busy)} onClick={() => act("skip")}>{busy === "skip" ? "Skipping…" : "Skip"}</button>
        )}
        {!editing && (
          <button className="btn big ghost" type="button" disabled={Boolean(busy)} onClick={() => { setEditing(true); setTimeout(() => textRef.current?.focus(), 0); }}>
            <Icon.pencil />Edit
          </button>
        )}
        {canLater && <button className="btn big ghost" type="button" disabled={Boolean(busy)} onClick={onLater}>Later</button>}
      </div>
      {!li && <p className="deck-hint">Nothing sends from here. Approved emails go out at the next send slot: {nextSendSlot().label} (09:53, 12:53 or 15:53 UK, weekdays).</p>}
      {li && !profile && <p className="deck-hint">No LinkedIn link on this one: copy the message and find them on LinkedIn yourself.</p>}
      {li && profile && <p className="deck-hint">You send LinkedIn messages yourself. Copy, paste, send, then press Mark sent.</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </article>
  );
}
