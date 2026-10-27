import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { useLoad } from "../lib/useLoad.ts";
import { copyNow, deckFit, outreachChanged, outreachDecide, outreachHold, outreachMarkSent, outreachUnpark } from "../lib/data.ts";
import { HOLD_REASONS, companyClashes, deckGroups, frontGroup, type Clash, type HoldKey } from "../lib/deck.ts";
import { DECK_STATUSES, activeInOrder, deckOrder, isLinkedIn, priorityPrompt } from "../lib/focus.ts";
import { sendStatusText, sentText, type SendState } from "../lib/today.ts";
import { apolloFailText, apolloSend, type ApolloFail } from "../lib/apollo.ts";
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

async function load(priorityId: string | null, opportunityId: string | null = null, emailOnly = false, oldApproved = false) {
  let q = oldApproved
    ? supabase.from("outreach").select(OUTREACH_COLS).eq("status", "approved").is("sent_at", null).order("approved_at", { ascending: true }).limit(300)
    : supabase.from("outreach").select(OUTREACH_COLS).in("status", [...DECK_STATUSES]).order("created_at", { ascending: true }).limit(300);
  if (priorityId) q = q.eq("priority_id", priorityId);
  if (opportunityId) q = q.eq("opportunity_id", opportunityId);
  // Parked drafts never reach the deck (the status filter already leaves them out; this keeps it so).
  let rows = withoutParked(must(await q) as unknown as Outreach[]);
  if (priorityId) rows = rows.filter((r) => r.priority_id === priorityId);
  if (emailOnly || oldApproved) rows = rows.filter((r) => !isLinkedIn(r));
  const ids = [...new Set(rows.map((r) => r.contact_id).filter(Boolean))] as string[];
  const people = new Map<string, Person>();
  const [ps, fit] = await Promise.all([
    ids.length ? supabase.from("crm_contacts").select("id,title,linkedin").in("id", ids.slice(0, 300)).then((r) => must(r) as unknown as Person[]) : Promise.resolve([] as Person[]),
    deckFit(rows),
  ]);
  for (const p of ps) people.set(p.id, p);
  return { rows, people, fit };
}

type Done = { text: string; ok: boolean };

/**
 * One email at a time, Send first: Send (Apollo sends it now, with the follow-ups), Hold (parked, with a reason),
 * Edit, Skip. There is no approve step. Cards are grouped by mandate with counts; when two drafts go to the same
 * company, the higher-fit one comes first and Send holds the other as a second contact at the same firm.
 * LinkedIn: Kuran always sends it himself: copy and open the profile, then mark it sent.
 * `emailOnly` keeps LinkedIn out (Today has its own LinkedIn panel). `oldApproved` reviews the older approved queue.
 */
export default function Deck({ priorities, priorityId = null, opportunityId = null, onChanged, emailOnly = false, sendEnabled = null, oldApproved = false }: {
  priorities: Priority[];
  priorityId?: string | null;
  opportunityId?: string | null;
  onChanged?: () => void;
  emailOnly?: boolean;
  sendEnabled?: SendState | null;
  oldApproved?: boolean;
}) {
  const handoffs = useHandoffs();
  const { data, error, loading, reload } = useLoad(() => load(priorityId, opportunityId, emailOnly, oldApproved), `deck-${priorityId ?? "all"}-${opportunityId ?? ""}-${emailOnly ? "email" : "all"}-${oldApproved ? "old" : "new"}`);
  const [queue, setQueue] = useState<string[] | null>(null);
  const [handled, setHandled] = useState(0);
  const [last, setLast] = useState<Done | null>(null);

  const byId = useMemo(() => new Map((data?.rows ?? []).map((r) => [r.id, r])), [data]);
  const prioById = useMemo(() => new Map(priorities.map((p) => [p.id, p])), [priorities]);

  // Order once per load (or when the priorities' order changes); afterwards the queue only shrinks or rotates,
  // so cards never jump about while Kuran works through them. Lower-fit second contacts at a firm go to the back.
  const psig = priorities.map((p) => `${p.id}:${p.rank}:${p.status}`).join(",");
  const prioRef = useRef(priorities);
  prioRef.current = priorities;
  useEffect(() => {
    if (!data) return;
    const ordered = deckOrder(data.rows, prioRef.current).map((r) => r.id);
    const clashes = companyClashes(data.rows.filter((r) => !isLinkedIn(r)), data.fit);
    const back = new Set([...clashes.values()].flatMap((c) => c.others));
    setQueue([...ordered.filter((id) => !back.has(id)), ...ordered.filter((id) => back.has(id))]);
    setHandled(0);
  }, [data, psig]);

  const queued = useMemo(() => (queue ?? []).map((id) => byId.get(id)).filter((r): r is Outreach => Boolean(r)), [queue, byId]);
  const clashes = useMemo(() => companyClashes(queued.filter((r) => !isLinkedIn(r)), data?.fit ?? new Map()), [queued, data]);
  const groups = useMemo(() => deckGroups(queued, priorities), [queued, priorities]);

  const current = queue && queue.length ? byId.get(queue[0]) ?? null : null;
  const total = handled + (queue?.length ?? 0);

  // Undo a hold: the drafts come back to the front of the queue.
  const restore = useCallback(async (ids: string[]) => {
    try {
      for (const id of ids) await outreachUnpark(id);
      setQueue((q) => [...ids.filter((id) => !(q ?? []).includes(id)), ...(q ?? [])]);
      setHandled((h) => Math.max(0, h - ids.length));
      setLast(null);
      outreachChanged();
      onChanged?.();
      toast(ids.length === 1 ? "Undone. It's back in the deck." : `Undone. ${ids.length} are back in the deck.`);
    } catch (e) {
      toast(friendlyError(e), false);
    }
  }, [onChanged]);

  const advance = useCallback((done: Done | null, rotate = false, alsoGone: string[] = []) => {
    setQueue((q) => {
      if (!q || !q.length) return q;
      const rest = rotate ? [...q.slice(1), q[0]] : q.slice(1);
      return alsoGone.length ? rest.filter((id) => !alsoGone.includes(id)) : rest;
    });
    if (!rotate) setHandled((h) => h + 1 + alsoGone.length);
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
        <h3>{oldApproved ? "No older approved emails left." : handled > 0 ? "All done. Nothing else is waiting for you." : filtered ? "Nothing waiting on this priority." : emailOnly ? "No emails waiting to send." : "Nothing waiting for you."}</h3>
        {top && handoffs && !oldApproved && (
          <p className="muted">
            Want more? Ask Claude to find people and draft for {filtered ? "this priority" : `priority ${top.rank}`}.
          </p>
        )}
        {top && handoffs && !oldApproved && (
          <div className="action-row">
            <AskClaude prompt={priorityPrompt(filtered ?? top, "find")}><Icon.claude />Ask Claude for more</AskClaude>
            {priorityId && <Link className="btn big" to="/review">Review everything else</Link>}
          </div>
        )}
      </div>
    );
  }

  const pos = handled + 1;
  // "Send all" covers the email drafts in the queue for the same mandate as the card on screen, one per company.
  const curPrio = current.priority_id ? prioById.get(current.priority_id) ?? null : null;
  const group = curPrio && !isLinkedIn(current)
    ? {
        key: curPrio.id,
        label: `priority ${curPrio.rank}: ${curPrio.title}`,
        rows: queued.filter((r) => r.priority_id === curPrio.id && ["draft", "approved"].includes(r.status) && !isLinkedIn(r)),
      }
    : null;
  const clash = !isLinkedIn(current) ? clashes.get(current.id) ?? null : null;
  const siblings = clash ? queued.filter((r) => r.id !== current.id && clashes.get(r.id)?.domain === clash.domain) : [];
  return (
    <div className="deck">
      <div className="deck-top">
        <span className="deck-count" aria-live="polite"><b>{fmtNumber(pos)}</b> of {fmtNumber(total)}</span>
        <span className="deck-keys" aria-hidden>
          {isLinkedIn(current) ? <><kbd>C</kbd> copy and open</> : <><kbd>S</kbd> send <kbd>H</kbd> hold</>} <kbd>E</kbd> edit <kbd>K</kbd> skip <kbd>L</kbd> later
        </span>
      </div>
      <div className="deck-bar" aria-hidden><span style={{ width: `${(handled / Math.max(1, total)) * 100}%` }} /></div>
      {groups.length > 1 && (
        <div className="deck-groups" role="group" aria-label="Drafts by mandate">
          {groups.map((g) => {
            const here = g.ids.includes(current.id);
            return (
              <button key={g.key} type="button" className={`deck-group${here ? " is-here" : ""}`} aria-pressed={here}
                onClick={() => setQueue((q) => frontGroup(q ?? [], g.ids))} title={`Work ${g.label} next`}>
                <span>{g.label}</span> <b>{fmtNumber(g.ids.length)}</b>
              </button>
            );
          })}
        </div>
      )}
      {last && <p className={`deck-last ${last.ok ? "ok" : "error"}`} role="status">{last.text}</p>}
      {group && group.rows.length > 1 && (
        <SendAll
          key={`${group.key}-${group.rows.length}`}
          label={group.label}
          rows={group.rows}
          clashes={clashes}
          onDone={(ids, failText) => {
            setQueue((q) => (q ?? []).filter((id) => !ids.includes(id)));
            setHandled((h) => h + ids.length);
            setLast({ ok: !failText, text: `Sent ${ids.length} for ${group.label} via Apollo.${failText ? ` ${failText}` : ""}` });
            outreachChanged();
            onChanged?.();
          }}
        />
      )}
      <DeckCard
        key={current.id}
        o={current}
        person={current.contact_id ? data?.people.get(current.contact_id) ?? null : null}
        priority={current.priority_id ? prioById.get(current.priority_id) ?? null : null}
        fit={data?.fit.get(current.id) ?? null}
        clash={clash}
        siblings={siblings}
        fitOf={(id) => data?.fit.get(id) ?? null}
        canLater={queue.length > 1}
        sendEnabled={sendEnabled}
        onDone={advance}
        onUndo={restore}
        onLater={() => advance(null, true)}
      />
    </div>
  );
}

function DeckCard({ o, person, priority, fit, clash, siblings, fitOf, canLater, sendEnabled, onDone, onUndo, onLater }: {
  o: Outreach;
  person: Person | null;
  priority: Priority | null;
  fit: number | null;
  clash: Clash | null;
  siblings: Outreach[];
  fitOf: (id: string) => number | null;
  canLater: boolean;
  sendEnabled: SendState | null;
  onDone: (d: Done, rotate?: boolean, alsoGone?: string[]) => void;
  onUndo: (ids: string[]) => void;
  onLater: () => void;
}) {
  const li = isLinkedIn(o);
  const manual = o.status === "manual";
  const [editing, setEditing] = useState(false);
  const [holding, setHolding] = useState(false);
  const [otherWhy, setOtherWhy] = useState("");
  const [subject, setSubject] = useState(o.subject ?? "");
  const [body, setBody] = useState(o.body ?? "");
  const [saved, setSaved] = useState({ subject: o.subject ?? "", body: o.body ?? "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [apolloFail, setApolloFail] = useState<ApolloFail | null>(null);
  // One per company: sending the higher-fit one holds the others at that firm, unless Kuran unticks it.
  const keepThis = Boolean(clash && clash.keep === o.id);
  const [holdSiblings, setHoldSiblings] = useState(true);
  const dirty = subject !== saved.subject || body !== saved.body;
  const profile = safeHref(o.link) ?? safeHref(person?.linkedin);
  // The person's LinkedIn profile, shown on email cards too when known (for a quick look before sending).
  const liProfile = safeHref(person?.linkedin) ?? (/linkedin\.com\//i.test(o.link ?? "") ? safeHref(o.link) : null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const saveEdit = async () => {
    await outreachDecide(o.id, "edit", li ? o.subject : subject, body);
    setSaved({ subject, body });
  };

  const hold = async (reason: HoldKey) => {
    if (busy) return;
    if (reason === "other" && !otherWhy.trim()) { setErr("Say why in a few words, then press Hold."); return; }
    setBusy("hold");
    setErr(null);
    try {
      if (dirty && !manual) await saveEdit();
      const n = await outreachHold([{ id: o.id, note: o.note }], reason, otherWhy);
      if (n === 0) throw new Error("It had already moved on. Reload to see where it is.");
      const label = HOLD_REASONS.find((r) => r.key === reason)?.label.toLowerCase() ?? "held";
      const text = `Held ${o.to_name || "that one"} (${label}). It won't be sent.`;
      onDone({ ok: true, text });
      toast(text, true, { ms: 9000, actions: [{ label: "Undo", primary: true, run: () => onUndo([o.id]) }] });
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const act = async (what: "skip" | "sent" | "save" | "send") => {
    if (busy) return;
    setBusy(what);
    setErr(null);
    setApolloFail(null);
    try {
      if (what === "save") {
        await saveEdit();
        setEditing(false);
        toast("Edit saved.");
        return;
      }
      if (dirty && !manual && what !== "skip") await saveEdit();
      if (what === "send") {
        // Send: Apollo puts them into the sequence for this line and sends it, with the follow-ups.
        const r = await apolloSend(o.id);
        if (!r.ok) { setApolloFail(r); return; }
        let heldText = "";
        const gone: string[] = [];
        if (keepThis && holdSiblings && siblings.length) {
          const n = await outreachHold(siblings.map((s) => ({ id: s.id, note: s.note })), "same_firm");
          if (n) {
            gone.push(...siblings.map((s) => s.id));
            heldText = ` Held ${n} other${n === 1 ? "" : "s"} at ${clash?.domain} (second contact at same firm).`;
          }
        }
        const text = `${sentText(o.to_name, r.sequence?.name ?? null)}${heldText}${r.note ? ` ${r.note}` : ""}${r.warning ? ` ${r.warning}` : ""}`;
        onDone({ ok: true, text }, false, gone);
        if (gone.length) toast(heldText.trim(), true, { ms: 9000, actions: [{ label: "Undo hold", primary: true, run: () => onUndo(gone) }] });
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

  // Keyboard on desktop: S send, H hold, E edit, K skip, C copy (and open LinkedIn), L later.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Another list (the New leads queue) already handled this key.
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (document.querySelector(".palette")) return;
      const k = e.key.toLowerCase();
      if (k === "s" && !li && o.to_email) { e.preventDefault(); void act("send"); }
      else if (k === "h" && !li) { e.preventDefault(); setHolding(true); }
      else if (k === "k" && !manual) { e.preventDefault(); void act("skip"); }
      else if (k === "e") { e.preventDefault(); setEditing(true); setTimeout(() => textRef.current?.focus(), 0); }
      else if (k === "c") { e.preventDefault(); if (li) copyOpen(); else toast(copyNow(body) ? "Copied." : "Your browser would not copy it.", true); }
      else if (k === "l" && canLater) { e.preventDefault(); onLater(); }
      else if (k === "escape" && holding) { setHolding(false); }
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
        {fit !== null && <span className="ctag">Fit {Math.round(fit)}</span>}
        {manual && <span className="ctag">Approved, not sent yet</span>}
        {o.status === "approved" && !li && <span className="ctag">Older approved</span>}
      </div>
      <div className="deck-who">
        <h3>{who}</h3>
        {role && <p>{role}</p>}
        {!li && o.to_email && <p className="mono small muted">{o.to_email}</p>}
        {liProfile && (
          <p className="small"><a href={liProfile} target="_blank" rel="noopener noreferrer">LinkedIn profile<Icon.external /></a></p>
        )}
      </div>

      {clash && siblings.length > 0 && (
        <div className="deck-clash" role="note">
          <p>
            <strong>One per company:</strong> {siblings.length === 1 ? "another draft goes" : `${siblings.length} other drafts go`} to {clash.domain}
            {" "}({siblings.map((s) => `${s.to_name || s.to_email}${fitOf(s.id) !== null ? `, fit ${Math.round(fitOf(s.id)!)}` : ""}`).join("; ")}).
            {keepThis ? " This one has the higher fit." : " The other has the higher fit; consider holding this one."}
          </p>
          {keepThis && (
            <label className="check small">
              <input type="checkbox" checked={holdSiblings} onChange={(e) => setHoldSiblings(e.target.checked)} />
              <span>Send also holds {siblings.length === 1 ? "the other" : `the other ${siblings.length}`} (second contact at same firm)</span>
            </label>
          )}
        </div>
      )}

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
          <>
            <button className="btn big primary" type="button" disabled={Boolean(busy) || !o.to_email} onClick={() => act("send")} title={o.to_email ? "Sends through Apollo now, with the follow-ups" : "No email address on this draft"}>
              {busy === "send" ? "Sending…" : dirty ? "Save & send" : "Send"}
            </button>
            <button className="btn big" type="button" disabled={Boolean(busy)} aria-expanded={holding} onClick={() => setHolding((v) => !v)}>Hold</button>
          </>
        )}
        {!editing && (
          <button className="btn big ghost" type="button" disabled={Boolean(busy)} onClick={() => { setEditing(true); setTimeout(() => textRef.current?.focus(), 0); }}>
            <Icon.pencil />Edit
          </button>
        )}
        {!manual && (
          <button className="btn big ghost" type="button" disabled={Boolean(busy)} onClick={() => act("skip")}>{busy === "skip" ? "Skipping…" : "Skip"}</button>
        )}
        {canLater && <button className="btn big ghost" type="button" disabled={Boolean(busy)} onClick={onLater}>Later</button>}
      </div>
      {!li && holding && (
        <div className="deck-hold" role="group" aria-label="Why hold it">
          <span className="muted small">Hold because:</span>
          {HOLD_REASONS.filter((r) => r.key !== "other").map((r) => (
            <button key={r.key} type="button" className="btn small" disabled={Boolean(busy)} onClick={() => void hold(r.key)}>{r.label}</button>
          ))}
          <span className="deck-hold-other">
            <input aria-label="Other reason" placeholder="Other reason" value={otherWhy} onChange={(e) => setOtherWhy(e.target.value)} maxLength={140}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void hold("other"); } }} />
            <button type="button" className="btn small" disabled={Boolean(busy) || !otherWhy.trim()} onClick={() => void hold("other")}>Hold</button>
          </span>
        </div>
      )}
      {!li && apolloFail && <ApolloNote fail={apolloFail} />}
      {!li && <p className="deck-hint">{sendStatusText(sendEnabled)} Apollo sends the follow-ups too.</p>}
      {li && !profile && <p className="deck-hint">No LinkedIn link on this one: copy the message and find them on LinkedIn yourself.</p>}
      {li && profile && <p className="deck-hint">You send LinkedIn messages yourself. Copy, paste, send, then press Mark sent.</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </article>
  );
}

/** A failed Apollo call, in one line, with the place to fix it when there is one. */
export function ApolloNote({ fail }: { fail: ApolloFail }) {
  const { text, link } = apolloFailText(fail);
  return (
    <p className={`apollo-note${fail.reason === "missing_api_key" ? " is-setup" : ""}`} role="alert">
      {text}{link && <> <a href={link.href} target="_blank" rel="noopener noreferrer">{link.label}<Icon.external /></a></>}
    </p>
  );
}

/** Sends several drafts through Apollo, one after another. Stops at the first problem that would stop them all. */
async function sendMany(ids: string[], onStep?: (n: number) => void): Promise<{ sent: string[]; fails: ApolloFail[] }> {
  const sent: string[] = [];
  const fails: ApolloFail[] = [];
  for (const id of ids) {
    const r = await apolloSend(id);
    if (r.ok) sent.push(id);
    else {
      fails.push(r);
      if (["missing_api_key", "apollo_auth", "unreachable", "not_allowed", "rate_limited"].includes(r.reason)) break;
    }
    onStep?.(sent.length + fails.length);
  }
  return { sent, fails };
}

/** "Send all N for <mandate>": a preview list, then a confirm step. One per company: lower-fit second contacts stay in the deck. */
function SendAll({ label, rows, clashes, onDone }: {
  label: string;
  rows: Outreach[];
  clashes: Map<string, Clash>;
  onDone: (ids: string[], failText: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<ApolloFail | null>(null);
  const ids = new Set(rows.map((r) => r.id));
  const left = rows.filter((r) => { const c = clashes.get(r.id); return c && c.keep !== r.id && ids.has(c.keep); });
  const send = rows.filter((r) => !left.includes(r) && r.to_email);
  const n = send.length;

  const sendAll = async () => {
    setBusy(true);
    setFail(null);
    const { sent, fails } = await sendMany(send.map((r) => r.id));
    setBusy(false);
    if (sent.length === 0) { setFail(fails[0] ?? { ok: false, reason: "error", message: "Nothing was sent." }); return; }
    setOpen(false);
    onDone(sent, fails.length ? `${fails.length} not sent: ${apolloFailText(fails[0]).text}` : null);
  };

  if (n < 2) return null;
  if (!open) {
    return (
      <div className="deck-all">
        <button type="button" className="btn small" onClick={() => setOpen(true)}>Send all {fmtNumber(n)} for {label}</button>
      </div>
    );
  }
  return (
    <div className="deck-all is-open card" role="group" aria-label={`Send all ${n} for ${label}`}>
      <p><strong>Send these {fmtNumber(n)} emails for {label}?</strong></p>
      <ol className="deck-all-list">
        {send.map((r) => (
          <li key={r.id}>
            <span>{r.to_name || "Unnamed recipient"}{r.company ? <span className="muted">, {r.company}</span> : null}</span>
            {r.subject && <span className="muted small"> · {r.subject}</span>}
          </li>
        ))}
      </ol>
      {left.length > 0 && <p className="muted small">Left in the deck (second contact at the same firm): {left.map((r) => r.to_name || r.to_email).join(", ")}.</p>}
      <p className="muted small">Each goes into the Apollo sequence for its line; Apollo sends it and the follow-ups. Sent emails cannot be recalled.</p>
      <div className="action-row">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void sendAll()}>{busy ? "Sending…" : `Confirm: send ${fmtNumber(n)}`}</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {fail && <ApolloNote fail={fail} />}
    </div>
  );
}
