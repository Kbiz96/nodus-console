import { useMemo, useState } from "react";
import { copyNow, linkedinLoad, linkedinRequestSent, outreachChanged, outreachDecide, outreachMarkSent, type LiContact } from "../lib/data.ts";
import { useLoad } from "../lib/useLoad.ts";
import { connectionNote, splitLinkedIn } from "../lib/today.ts";
import { fmtNumber, safeHref } from "../lib/format.ts";
import { friendlyError } from "../lib/rules.ts";
import { remember } from "../lib/calm.ts";
import type { Outreach } from "../lib/types.ts";
import { Icon } from "./Brand.tsx";
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
  const rows = (data?.rows ?? []).filter((r) => !gone.has(r.id));
  const { ready, waiting } = splitLinkedIn(rows, notes);
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
