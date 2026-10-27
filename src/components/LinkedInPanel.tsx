import { useMemo, useState } from "react";
import { copyNow, linkedinLoad, linkedinRequestSent, outreachChanged, outreachDecide, outreachMarkSent, type LiContact } from "../lib/data.ts";
import { useLoad } from "../lib/useLoad.ts";
import { connectionNote, splitLinkedIn } from "../lib/today.ts";
import { fmtNumber, safeHref } from "../lib/format.ts";
import { friendlyError } from "../lib/rules.ts";
import { remember } from "../lib/calm.ts";
import type { Outreach } from "../lib/types.ts";
import { Icon } from "./Brand.tsx";
import { AskClaude } from "./PriorityCard.tsx";
import { toast } from "./Toast.tsx";

const HIDE_KEY = "nodus-li-requested";

function hiddenIds(): Set<string> {
  try { return new Set(JSON.parse(remember(HIDE_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}

/**
 * LinkedIn on Today. Only people Kuran is already connected to get a DM ("Ready to send DM"). Everyone else is a
 * count, with their connection notes one tap away. Kuran always sends LinkedIn himself.
 */
export function LinkedInPanel() {
  const { data, error, reload } = useLoad(linkedinLoad, "linkedin-panel");
  const [gone, setGone] = useState<Set<string>>(() => hiddenIds());
  const [showNotes, setShowNotes] = useState(false);
  const notes = useMemo(() => new Map([...(data?.contacts ?? new Map<string, LiContact>()).values()].map((c) => [c.id, c.notes])), [data]);
  const [lane, setLane] = useState<Lane>("ALL");
  const [showComments, setShowComments] = useState(true);
  const all = (data?.rows ?? []).filter((r) => !gone.has(r.id));
  const rows = all.filter((r) => lane === "ALL" || laneOf(r) === lane);
  const { ready, waiting } = splitLinkedIn(rows, notes);
  const comments = rows.filter((r) => r.kind === "comment");
  const hide = (id: string, keep = false) => {
    const next = new Set(gone).add(id);
    setGone(next);
    if (keep) remember(HIDE_KEY, JSON.stringify([...next].slice(-300)));
  };
  const contactOf = (o: Outreach) => (o.contact_id ? data?.contacts.get(o.contact_id) ?? null : null);
  const profileOf = (o: Outreach) => safeHref(o.link) ?? safeHref(contactOf(o)?.linkedin);

  if (error && !data) return <p className="muted small">LinkedIn messages could not be loaded. <button type="button" className="link-btn" onClick={reload}>Try again</button></p>;
  if (!data) return <p className="muted small">Checking LinkedIn…</p>;

  return (
    <div className="li-panel">
      <AgentBar lane={lane} setLane={setLane} counts={laneCounts(all)} />
      {comments.length > 0 && (
        <div className="li-wait">
          <div className="li-wait-head">
            <p><b>{fmtNumber(comments.length)}</b> posts to comment on</p>
            <button type="button" className="btn small" aria-expanded={showComments} onClick={() => setShowComments((v) => !v)}>
              {showComments ? "Hide comments" : "Show comments"}
            </button>
          </div>
          {showComments && (
            <ul className="li-list">
              {comments.map((o) => <CommentRow key={o.id} o={o} onDone={() => hide(o.id, true)} />)}
            </ul>
          )}
        </div>
      )}
      {ready.length === 0 ? (
        <p className="li-none">No DMs ready for people you are connected to.</p>
      ) : (
        <ul className="li-list">
          {ready.map((o) => (
            <ReadyRow key={o.id} o={o} profile={profileOf(o)} onSent={() => hide(o.id)} />
          ))}
        </ul>
      )}
      {waiting.length > 0 && (
        <div className="li-wait">
          <div className="li-wait-head">
            <p><b>{fmtNumber(waiting.length)}</b> waiting for connection (send a connection note)</p>
            <button type="button" className="btn small" aria-expanded={showNotes} onClick={() => setShowNotes((v) => !v)}>
              {showNotes ? "Hide connection notes" : "Show connection notes"}
            </button>
          </div>
          {showNotes && (
            <ul className="li-list">
              {waiting.map((o) => (
                <NoteRow key={o.id} o={o} contact={contactOf(o)} profile={profileOf(o)} onDone={() => hide(o.id, true)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Who({ o }: { o: Outreach }) {
  return (
    <div className="li-who">
      <strong>{o.to_name || "Unnamed"}</strong>
      {o.company && <span className="muted"> at {o.company}</span>}
    </div>
  );
}

function ReadyRow({ o, profile, onSent }: { o: Outreach; profile: string | null; onSent: () => void }) {
  const [busy, setBusy] = useState(false);
  const copy = () => toast(copyNow(o.body ?? "") ? "Copied. Paste it into LinkedIn, send, then press Mark sent." : "Your browser would not copy it. Select the text and copy it by hand.");
  const sent = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (o.status !== "manual") await outreachDecide(o.id, "approve");
      await outreachMarkSent(o.id);
      outreachChanged();
      toast(`Marked sent to ${o.to_name ?? "them"} on LinkedIn.`);
      onSent();
    } catch (e) {
      toast(friendlyError(e), false);
      setBusy(false);
    }
  };
  return (
    <li className="li-row">
      <Who o={o} />
      <p className="li-msg">{o.body || "(no text)"}</p>
      <div className="li-acts">
        <button type="button" className="btn small" onClick={copy}>Copy</button>
        {profile && <a className="btn small" href={profile} target="_blank" rel="noopener noreferrer">Open profile<Icon.external /></a>}
        <button type="button" className="btn small primary" disabled={busy} onClick={() => void sent()}>{busy ? "Saving…" : "Mark sent"}</button>
      </div>
    </li>
  );
}

function NoteRow({ o, contact, profile, onDone }: { o: Outreach; contact: LiContact | null; profile: string | null; onDone: () => void }) {
  const note = connectionNote(o);
  const [busy, setBusy] = useState(false);
  const copy = () => toast(copyNow(note ?? "") ? "Copied. Paste it into the connection request, then press Request sent." : "Your browser would not copy it.");
  const done = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (contact) await linkedinRequestSent(contact.id, contact.notes);
      toast(`Request sent to ${o.to_name ?? "them"}. Their DM shows here once you are connected.`);
      onDone();
    } catch (e) {
      toast(friendlyError(e), false);
      setBusy(false);
    }
  };
  return (
    <li className="li-row">
      <Who o={o} />
      {note ? <p className="li-msg li-note">{note}</p> : <p className="li-msg muted">No connection note drafted. A short hello works.</p>}
      <div className="li-acts">
        <button type="button" className="btn small" disabled={!note} onClick={copy}>Copy</button>
        {profile && <a className="btn small" href={profile} target="_blank" rel="noopener noreferrer">Open profile<Icon.external /></a>}
        <button type="button" className="btn small" disabled={busy} onClick={() => void done()}>{busy ? "Saving…" : "Request sent"}</button>
      </div>
    </li>
  );
}

// ---------- LinkedIn agent (on demand) ----------

type Lane = "ALL" | "CAPITAL" | "COMPUTE" | "OPERATORS";
const LANES: { k: Lane; label: string }[] = [
  { k: "ALL", label: "What we need now" },
  { k: "CAPITAL", label: "Capital" },
  { k: "COMPUTE", label: "Compute" },
  { k: "OPERATORS", label: "Operators" },
];

/** Drafts written by the LinkedIn agent start their note with "LI: <LANE> · ...". */
export function laneOf(o: Pick<Outreach, "note">): Lane | null {
  const m = /^LI:\s*(CAPITAL|COMPUTE|OPERATORS)\b/.exec((o.note ?? "").trim());
  return m ? (m[1] as Lane) : null;
}

function laneCounts(rows: Outreach[]): Record<Lane, number> {
  const c: Record<Lane, number> = { ALL: rows.length, CAPITAL: 0, COMPUTE: 0, OPERATORS: 0 };
  for (const r of rows) { const l = laneOf(r); if (l) c[l] += 1; }
  return c;
}

export function agentPrompt(lane: Lane): string {
  const lanes = lane === "ALL" ? "whatever the live mandates and priorities need most (capital, compute and operators)" : lane.toLowerCase();
  return [
    `Nodus LinkedIn agent: run the nodus-linkedin-agent skill now in my Chrome (Claude in Chrome extension). Lane: ${lanes}.`,
    "Find leads among my existing 1st-degree connections and new people, qualify them against the live mandates, and write DM drafts (connected) or connection notes (not connected) into the console.",
    "Also find 25 recent posts worth commenting on (my lanes, last 7 days) and draft a comment for each.",
    "Read-only and human-paced: never click Connect, Message, Like, Comment or Send; at least 15 s between pages, 40 pages max. I send everything myself.",
  ].join("\n");
}

function AgentBar({ lane, setLane, counts }: { lane: Lane; setLane: (l: Lane) => void; counts: Record<Lane, number> }) {
  return (
    <div className="li-agent">
      <div className="li-agent-lanes" role="group" aria-label="Lane">
        {LANES.map((l) => (
          <button key={l.k} type="button" className={`btn small${lane === l.k ? " primary" : ""}`} aria-pressed={lane === l.k} onClick={() => setLane(l.k)}>
            {l.label}{l.k !== "ALL" && counts[l.k] > 0 ? ` (${fmtNumber(counts[l.k])})` : ""}
          </button>
        ))}
      </div>
      <AskClaude prompt={agentPrompt(lane)} className="btn primary">Run LinkedIn agent</AskClaude>
      <p className="muted small">Opens Claude with the instruction ready: press Enter, with Chrome and the Claude extension open. Drafts and comments land here.</p>
    </div>
  );
}

function CommentRow({ o, onDone }: { o: Outreach; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const post = safeHref(o.link);
  const copy = () => toast(copyNow(o.body ?? "") ? "Copied. Paste it under the post, then press Commented." : "Your browser would not copy it.");
  const done = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (o.status !== "manual") await outreachDecide(o.id, "approve");
      await outreachMarkSent(o.id);
      outreachChanged();
      onDone();
    } catch (e) {
      toast(friendlyError(e), false);
      setBusy(false);
    }
  };
  return (
    <li className="li-row">
      <Who o={o} />
      <p className="li-msg">{o.body || "(no text)"}</p>
      <div className="li-acts">
        <button type="button" className="btn small" onClick={copy}>Copy</button>
        {post && <a className="btn small" href={post} target="_blank" rel="noopener noreferrer">Open post<Icon.external /></a>}
        <button type="button" className="btn small primary" disabled={busy} onClick={() => void done()}>{busy ? "Saving…" : "Commented"}</button>
      </div>
    </li>
  );
}
