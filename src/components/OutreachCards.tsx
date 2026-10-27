import { useState } from "react";
import { copyText, outreachChanged, outreachDecide, outreachMarkSent } from "../lib/data.ts";
import { OUTREACH_KIND_LABEL, OUTREACH_STATUS_LABEL } from "../lib/crm.ts";
import { fmtDateTime } from "../lib/format.ts";
import { friendlyError } from "../lib/rules.ts";
import type { Outreach } from "../lib/types.ts";
import { apolloFailText, apolloSend } from "../lib/apollo.ts";
import { sentText } from "../lib/today.ts";
import { ExtLink } from "./ui.tsx";

export function OutreachMeta({ o }: { o: Outreach }) {
  return (
    <div className="meta">
      <span className="badge">{OUTREACH_KIND_LABEL[o.kind ?? ""] ?? o.kind ?? "Message"}</span>
      <span className={`badge ostatus-${o.status}`}>{OUTREACH_STATUS_LABEL[o.status] ?? o.status}</span>
      {o.sequence_step ? <span className="muted">Step {o.sequence_step}</span> : null}
      <span className="muted">{fmtDateTime(o.created_at)}</span>
      {o.link && <ExtLink url={o.link}>Open on LinkedIn</ExtLink>}
    </div>
  );
}

function who(o: Outreach): string {
  return [o.to_name, o.company].filter(Boolean).join(" · ") || "Unnamed recipient";
}

/** A draft waiting for Kuran: email Send (via Apollo, now), LinkedIn ready to send by hand; edit or skip through outreach_decide. */
export function DraftCard({ o, onChanged }: { o: Outreach; onChanged: () => void }) {
  const isEmail = o.channel === "email" || o.kind === "email" || o.kind === "followup";
  const [subject, setSubject] = useState(o.subject ?? "");
  const [body, setBody] = useState(o.body ?? "");
  const [saved, setSaved] = useState({ subject: o.subject ?? "", body: o.body ?? "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = subject !== saved.subject || body !== saved.body;

  const run = async (what: "approve" | "edit" | "skip" | "send") => {
    setBusy(what);
    setMsg(null);
    try {
      if ((what === "approve" || what === "send") && dirty) await outreachDecide(o.id, "edit", isEmail ? subject : o.subject, body);
      if (what === "send") {
        const r = await apolloSend(o.id);
        setMsg(r.ok ? { ok: true, text: sentText(o.to_name, r.sequence?.name ?? null) } : { ok: false, text: apolloFailText(r).text });
        if (r.ok) { outreachChanged(); onChanged(); }
        return;
      }
      await outreachDecide(o.id, what, what === "edit" ? (isEmail ? subject : o.subject) : null, what === "edit" ? body : null);
      if (what !== "skip") setSaved({ subject, body });
      setMsg({
        ok: true,
        text: what === "approve" ? "Ready. It is now under LinkedIn to send." : what === "edit" ? "Edit saved." : "Skipped.",
      });
      outreachChanged();
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: friendlyError(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="card stack-xs outreach">
      <div className="row-between wrap">
        <strong>{who(o)}</strong>
        {o.to_email && <span className="muted small">{o.to_email}</span>}
      </div>
      <OutreachMeta o={o} />
      {isEmail && (
        <label className="field">
          <span>Subject</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} />
        </label>
      )}
      <label className="field">
        <span>Message</span>
        <textarea rows={Math.min(14, Math.max(4, body.split("\n").length + 1))} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      {o.note && <p className="note">{o.note}</p>}
      <div className="action-row">
        {isEmail ? (
          <button className="btn primary small" type="button" disabled={Boolean(busy) || !o.to_email} onClick={() => run("send")}>
            {busy === "send" ? "Sending…" : dirty ? "Save & send" : "Send"}
          </button>
        ) : (
          <button className="btn primary small" type="button" disabled={Boolean(busy)} onClick={() => run("approve")}>
            {busy === "approve" ? "Saving…" : "Ready to send on LinkedIn"}
          </button>
        )}
        <button className="btn small" type="button" disabled={Boolean(busy) || !dirty} onClick={() => run("edit")}>
          {busy === "edit" ? "Saving…" : "Save edit"}
        </button>
        <button className="btn small ghost" type="button" disabled={Boolean(busy)} onClick={() => run("skip")}>
          {busy === "skip" ? "Skipping…" : "Skip"}
        </button>
      </div>
      {msg && <p className={`${msg.ok ? "ok" : "error"} small`} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    </article>
  );
}

/** A LinkedIn item Kuran sends himself: copy the text, open the profile, then mark it sent. */
export function ManualCard({ o, onChanged }: { o: Outreach; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const copy = async () => {
    const ok = await copyText(o.body ?? "");
    setMsg(ok ? { ok: true, text: "Copied." } : { ok: false, text: "Your browser would not copy it. Select the text and copy it by hand." });
  };
  const markSent = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await outreachMarkSent(o.id);
      outreachChanged();
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="card stack-xs outreach">
      <strong>{who(o)}</strong>
      <OutreachMeta o={o} />
      <div className="draft-text crm-text">{o.body || "(no text)"}</div>
      <div className="action-row">
        <button className="btn small" type="button" onClick={copy}>Copy</button>
        {o.link ? <ExtLink url={o.link}>Open profile</ExtLink> : <span className="muted small">No LinkedIn link</span>}
        <button className="btn primary small" type="button" disabled={busy} onClick={markSent}>{busy ? "Saving…" : "Mark sent"}</button>
      </div>
      {msg && <p className={`${msg.ok ? "ok" : "error"} small`} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    </article>
  );
}

/** A read-only line of outreach history. */
export function OutreachLine({ o }: { o: Outreach }) {
  return (
    <li className="list-item">
      <div className="list-main">
        <strong>{o.subject || who(o)}</strong>
        <OutreachMeta o={o} />
        {o.body && (
          <details className="evidence">
            <summary>Show message</summary>
            <div className="draft-text small">{o.body}</div>
          </details>
        )}
        {o.sent_at && <p className="muted small">Sent {fmtDateTime(o.sent_at)}</p>}
        {o.replied_at && <p className="ok small">Replied {fmtDateTime(o.replied_at)}</p>}
      </div>
    </li>
  );
}
