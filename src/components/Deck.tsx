import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { useLoad } from "../lib/useLoad.ts";
import { copyNow, outreachChanged, outreachDecide, outreachMarkSent, outreachUnapprove } from "../lib/data.ts";
import { DECK_STATUSES, activeInOrder, deckOrder, isLinkedIn, nextSendSlot, priorityPrompt } from "../lib/focus.ts";
import { approvedText, isSendOn, sendStatusText, type SendState } from "../lib/today.ts";
import { useHandoffs } from "./handoff.ts";
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

async function load(priorityId: string | null, opportunityId: string | null = null, emailOnly = false) {
  let q = supabase.from("outreach").select(OUTREACH_COLS).in("status", [...DECK_STATUSES]).order("created_at", { ascending: true }).limit(300);
  if (priorityId) q = q.eq("priority_id", priorityId);
  if (opportunityId) q = q.eq("opportunity_id", opportunityId);
  // Parked drafts never reach the deck (the status filter already leaves them out; this keeps it so).
  let rows = withoutParked(must(await q) as unknown as Outreach[]);
  if (priorityId) rows = rows.filter((r) => r.priority_id === priorityId);
  if (emailOnly) rows = rows.filter((r) => !isLinkedIn(r));
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
 * One draft at a time. Email: approve (the send batch sends it at the next slot when sending is on), skip or edit.
 * LinkedIn: Kuran always sends it himself: copy and open the profile, then mark it sent.
 * `emailOnly` keeps LinkedIn out (Today has its own LinkedIn panel). `sendEnabled`: the brief's flag, or failing that what last went out.
 */
export default function Deck({ priorities, priorityId = null, opportunityId = null, onChanged, emailOnly = false, sendEnabled = null }: {
  priorities: Priority[];
  priorityId?: string | null;
  opportunityId?: string | null;
  onChanged?: () => void;
  emailOnly?: boolean;
  sendEnabled?: SendState | null;
}) {
  const handoffs = useHandoffs();
  const { data, error, loading, reload } = useLoad(() => load(priorityId, opportunityId, emailOnly), `deck-${priorityId ?? "all"}-${opportunityId ?? ""}-${emailOnly ? "email" : "all"}`);
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

  // Undo: put approved emails back at the front of the queue as drafts.
  const restore = useCallback(async (ids: string[]) => {
    try {
      const n = await outreachUnapprove(ids);
      if (n === 0) {
        toast("Too late to undo: the send batch already took it.", false);
        return;
      }
      setQueue((q) => [...ids.filter((id) => !(q ?? []).includes(id)), ...(q ?? [])]);
      setHandled((h) => Math.max(0, h - ids.length));
      setLast(null);
      outreachChanged();
      onChanged?.();
      toast(n === 1 ? "Undone. It's back as a draft." : `Undone. ${n} are back as drafts.`);
    } catch (e) {
      toast(friendlyError(e), false);
    }
  }, [onChanged]);

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

  if (!current && opportunityId) {
    return (
      <div className="deck-empty">
        {last && <p className={last.ok ? "ok" : "error"} role="status">{last.text}</p>}
        <h3>{handled > 0 ? "All done for this opportunity." : "No drafts waiting for this opportunity yet."}</h3>
        <p className="muted">If Claude is still drafting, they appear here when it saves them.</p>
        <div className="action-row">
          <Link className="btn big" to={`/opportunities/${opportunityId}`}>Back to the opportunity</Link>
          <Link className="btn big" to="/review">Review everything else</Link>
        </div>
      </div>
    );
  }

  if (!current) {
    const top = activeInOrder(priorities)[0];
    const filtered = priorityId ? prioById.get(priorityId) : null;
    return (
      <div className="deck-empty">
        {last && <p className={last.ok ? "ok" : "error"} role="status">{last.text}</p>}
        <h3>{handled > 0 ? "All done. Nothing else is waiting for you." : filtered ? "Nothing waiting on this priority." : emailOnly ? "No emails waiting for approval." : "Nothing waiting for you."}</h3>
        {top && handoffs && (
          <p className="muted">
            Want more? Ask Claude to find people and draft for {filtered ? "this priority" : `priority ${top.rank}`}.
          </p>
        )}
        {top && handoffs && (
          <div className="action-row">
            <AskClaude prompt={priorityPrompt(filtered ?? top, "find")}><Icon.claude />Ask Claude for more</AskClaude>
            {priorityId && <Link className="btn big" to="/review">Review everything else</Link>}
          </div>
        )}
      </div>
    );
  }

  const pos = handled + 1;
  // "Approve all" covers the email drafts in the queue that serve the same priority as the card on screen.
  const curPrio = current.priority_id ? prioById.get(current.priority_id) ?? null : null;
  const group = curPrio && !isLinkedIn(current)
    ? {
        key: curPrio.id,
        label: `priority ${curPrio.rank}: ${curPrio.title}`,
        rows: queue.map((id) => byId.get(id)).filter((r): r is Outreach => Boolean(r && r.priority_id === curPrio.id && r.status === "draft" && !isLinkedIn(r))),
      }
    : null;
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
      {group && group.rows.length > 1 && (
        <ApproveAll
          key={`${group.key}-${group.rows.length}`}
          label={group.label}
          rows={group.rows}
          sendEnabled={sendEnabled}
          onApproved={(ids, failed) => {
            setQueue((q) => (q ?? []).filter((id) => !ids.includes(id)));
            setHandled((h) => h + ids.length);
            setLast({ ok: failed === 0, text: `Approved ${ids.length} for ${group.label}.${failed ? ` ${failed} could not be approved; they stay in the deck.` : ""}` });
            outreachChanged();
            onChanged?.();
            toast(`Approved ${ids.length} for ${group.label}.`, true, { ms: 10000, actions: [{ label: "Undo", primary: true, run: () => void restore(ids) }] });
          }}
        />
      )}
      <DeckCard
        key={current.id}
        o={current}
        person={current.contact_id ? data?.people.get(current.contact_id) ?? null : null}
        priority={current.priority_id ? prioById.get(current.priority_id) ?? null : null}
        canLater={queue.length > 1}
        sendEnabled={sendEnabled}
        onDone={advance}
        onUndo={restore}
        onLater={() => advance(null, true)}
      />
    </div>
  );
}

function DeckCard({ o, person, priority, canLater, sendEnabled, onDone, onUndo, onLater }: {
  o: Outreach;
  person: Person | null;
  priority: Priority | null;
  canLater: boolean;
  sendEnabled: SendState | null;
  onDone: (d: Done) => void;
  onUndo: (ids: string[]) => void;
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
  // The person's LinkedIn profile, shown on email cards too when known (for a quick look before approving).
  const liProfile = safeHref(person?.linkedin) ?? (/linkedin\.com\//i.test(o.link ?? "") ? safeHref(o.link) : null);
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
        const text = approvedText(o.to_name, sendEnabled, nextSendSlot().label);
        onDone({ ok: true, text });
        toast(text, true, { ms: 9000, actions: [{ label: "Undo", primary: true, run: () => onUndo([o.id]) }] });
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
        {liProfile && (
          <p className="small"><a href={liProfile} target="_blank" rel="noopener noreferrer">LinkedIn profile<Icon.external /></a></p>
        )}
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

      {o.note && (
        <details className="deck-why">
          <summary>Why this person</summary>
          <p>{o.note}</p>
        </details>
      )}

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
            {busy === "approve" ? "Approving…" : dirty ? "Save & approve" : "Approve"}
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
      {!li && <p className={`deck-hint${isSendOn(sendEnabled) ? "" : " is-paused"}`}>Nothing sends from here. {sendStatusText(sendEnabled)}</p>}
      {li && !profile && <p className="deck-hint">No LinkedIn link on this one: copy the message and find them on LinkedIn yourself.</p>}
      {li && profile && <p className="deck-hint">You send LinkedIn messages yourself. Copy, paste, send, then press Mark sent.</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </article>
  );
}

/** "Approve all N for <priority>": a preview list, then a confirm step. Nothing is approved until Confirm. */
function ApproveAll({ label, rows, sendEnabled, onApproved }: {
  label: string;
  rows: Outreach[];
  sendEnabled: SendState | null;
  onApproved: (ids: string[], failed: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = rows.length;

  const confirm = async () => {
    setBusy(true);
    setErr(null);
    const ok: string[] = [];
    let failed = 0;
    let lastErr: unknown = null;
    for (const r of rows) {
      try {
        await outreachDecide(r.id, "approve");
        ok.push(r.id);
      } catch (e) {
        failed++;
        lastErr = e;
      }
    }
    setBusy(false);
    if (ok.length === 0) {
      setErr(lastErr ? friendlyError(lastErr) : "Nothing was approved.");
      return;
    }
    setOpen(false);
    onApproved(ok, failed);
  };

  if (!open) {
    return (
      <div className="deck-all">
        <button type="button" className="btn small" onClick={() => setOpen(true)}>Approve all {fmtNumber(n)} for {label}</button>
      </div>
    );
  }
  return (
    <div className="deck-all is-open card" role="group" aria-label={`Approve all ${n} for ${label}`}>
      <p><strong>Approve these {fmtNumber(n)} emails for {label}?</strong></p>
      <ol className="deck-all-list">
        {rows.map((r) => (
          <li key={r.id}>
            <span>{r.to_name || "Unnamed recipient"}{r.company ? <span className="muted">, {r.company}</span> : null}</span>
            {r.subject && <span className="muted small"> · {r.subject}</span>}
          </li>
        ))}
      </ol>
      <p className="muted small">{sendStatusText(sendEnabled)} You can undo straight after.</p>
      <div className="action-row">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void confirm()}>{busy ? "Approving…" : `Confirm: approve ${fmtNumber(n)}`}</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {err && <p className="error small" role="alert">{err}</p>}
    </div>
  );
}
