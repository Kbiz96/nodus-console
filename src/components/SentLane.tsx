import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLoad } from "../lib/useLoad.ts";
import { apolloActivity, activityLanes, replyClassLabel, type ActivityRow } from "../lib/apollo.ts";
import { dealFromReply, oldApprovedLoad, oldApprovedParkAll, outreachChanged } from "../lib/data.ts";
import { gmailSearchUrl } from "../lib/today.ts";
import { fmtNumber } from "../lib/format.ts";
import { friendlyError } from "../lib/rules.ts";
import { Icon } from "./Brand.tsx";
import { ApolloNote } from "./Deck.tsx";
import { toast } from "./Toast.tsx";

const SEQ_LABEL: Record<string, string> = { active: "In sequence", paused: "Paused", finished: "Finished", failed: "Failed", unknown: "Status unknown" };

/**
 * Sent & replies: what Apollo saw for the emails Nodus enrolled in the last 30 days. Replied first (reply in Gmail,
 * move to a deal), then bounced, then still in sequence. Loaded when Kuran opens it, never on a timer.
 */
export function SentLane() {
  const [open, setOpen] = useState(false);
  return (
    <details className="sent-lane" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <span>Sent &amp; replies</span>
        <span className="muted small">Apollo, last 30 days</span>
      </summary>
      {open && <SentBody />}
    </details>
  );
}

function SentBody() {
  const { data, loading, reload } = useLoad(apolloActivity, "apollo-activity");
  if (loading && !data) return <p className="muted small">Asking Apollo…</p>;
  if (!data) return null;
  if (!data.ok) return <ApolloNote fail={data} />;
  const { replied, bounced, inSequence } = activityLanes(data.rows);
  if (!data.rows.length) return <p className="muted small">Nothing sent through Apollo in the last 30 days.</p>;
  return (
    <div className="sent-body">
      {data.updated > 0 && <p className="ok small" role="status">{fmtNumber(data.updated)} new {data.updated === 1 ? "reply" : "replies"} logged in the CRM.</p>}
      <Lane title="Replied" rows={replied} kind="replied" />
      <Lane title="Bounced" rows={bounced} kind="bounced" />
      <Lane title="In sequence" rows={inSequence} kind="seq" />
      <button type="button" className="btn small ghost" onClick={reload}>Check again</button>
    </div>
  );
}

function Lane({ title, rows, kind }: { title: string; rows: ActivityRow[]; kind: "replied" | "bounced" | "seq" }) {
  if (!rows.length) return null;
  return (
    <div className={`sent-group is-${kind}`}>
      <h4>{title} <span className="muted">{fmtNumber(rows.length)}</span></h4>
      <ul className="sent-list">
        {rows.map((r) => <SentRow key={r.outreach_id} r={r} kind={kind} />)}
      </ul>
    </div>
  );
}

function SentRow({ r, kind }: { r: ActivityRow; kind: "replied" | "bounced" | "seq" }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const who = [r.to_name || r.to_email, r.company].filter(Boolean).join(" at ");
  const facts = [
    kind === "replied" ? replyClassLabel(r.reply_class) : null,
    kind === "seq" ? SEQ_LABEL[r.sequence_status] : null,
    `${fmtNumber(r.sent)} sent`,
    r.opens ? `${fmtNumber(r.opens)} opened` : null,
  ].filter(Boolean).join(" · ");
  const toDeal = async () => {
    setBusy(true);
    try {
      const id = await dealFromReply(r);
      toast(`Deal opened for ${r.to_name || r.to_email}.`);
      navigate(`/deals?id=${id}`);
    } catch (e) {
      toast(friendlyError(e), false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="sent-row">
      <div className="sent-who">
        {r.contact_id ? <Link to={`/contacts?id=${r.contact_id}`}>{who}</Link> : <span>{who}</span>}
        <span className="muted small">{facts}</span>
      </div>
      {kind === "replied" && (
        <div className="sent-acts">
          <a className="btn small primary" href={gmailSearchUrl(r.to_email)} target="_blank" rel="noopener noreferrer">Reply in Gmail<Icon.external /></a>
          <button type="button" className="btn small" disabled={busy} onClick={() => void toDeal()}>{busy ? "Opening…" : "Move to deal"}</button>
        </div>
      )}
    </li>
  );
}

/** Emails approved under the old scheduled sending and never sent: folded away, reviewed or parked in one go. */
export function OlderApproved() {
  const { data, reload } = useLoad(oldApprovedLoad, "old-approved");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  if (!data || data.count === 0) return null;
  const parkAll = async () => {
    setBusy(true);
    try {
      const n = await oldApprovedParkAll(data.rows);
      toast(`Parked ${fmtNumber(n)} older approved ${n === 1 ? "email" : "emails"}. Nothing was sent.`);
      outreachChanged();
      reload();
    } catch (e) {
      toast(friendlyError(e), false);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };
  return (
    <details className="old-approved">
      <summary>
        <span>Older approved (pre-27 Oct style)</span>
        <span className="muted small">{fmtNumber(data.count)} not sent</span>
      </summary>
      <p className="muted small">Approved under the old scheduled sending and written before the new outbound style. None of these will be sent unless you press Send on each.</p>
      <div className="action-row">
        <Link className="btn small primary" to="/review?old=1">Review</Link>
        {confirm ? (
          <>
            <button type="button" className="btn small" disabled={busy} onClick={() => void parkAll()}>{busy ? "Parking…" : `Confirm: park all ${fmtNumber(data.count)}`}</button>
            <button type="button" className="btn small ghost" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
          </>
        ) : (
          <button type="button" className="btn small" onClick={() => setConfirm(true)}>Park all</button>
        )}
      </div>
    </details>
  );
}
