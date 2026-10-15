import { useState } from "react";
import { gateAdvance } from "../lib/data.ts";
import { GATE_LABEL } from "../lib/labels.ts";
import { CONFIRM_TEXT, friendlyError, needsConfirmation } from "../lib/rules.ts";

export default function GateControl({
  id,
  current,
  next,
  blocker,
  onMoved,
}: {
  id: string;
  current: string;
  next: string;
  blocker: string | null;
  onMoved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const confirm = needsConfirmation(next);

  if (blocker) {
    return (
      <div className="warn">
        <strong>Cannot move to {GATE_LABEL[next]} yet.</strong> {blocker}
      </div>
    );
  }

  return (
    <form
      className="stack gate-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setMsg(null);
        try {
          const now = await gateAdvance(id, note.trim(), confirmed);
          setMsg({ ok: true, text: `Moved on to ${GATE_LABEL[now] ?? now}.` });
          setConfirmed(false);
          setNote("");
          onMoved();
        } catch (err) {
          setMsg({ ok: false, text: friendlyError(err) });
        } finally {
          setPending(false);
        }
      }}
    >
      <label className="field">
        <span>Why are you moving it on? (a short note, kept in the history)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} required maxLength={1000} placeholder="e.g. Spoke to the owner on 15 Oct" />
      </label>
      {confirm && (
        <label className="check">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>{CONFIRM_TEXT[next]}</span>
        </label>
      )}
      <div>
        <button className="btn primary" type="submit" disabled={pending || !note.trim() || (confirm && !confirmed)}>
          {pending ? "Saving…" : `Move from ${GATE_LABEL[current]} to ${GATE_LABEL[next]}`}
        </button>
      </div>
      {msg && <p className={msg.ok ? "ok small" : "error small"} role="status">{msg.text}</p>}
    </form>
  );
}
