import { useState } from "react";
import { downloadJson, matchDecide, matchExport, matchReject } from "../lib/data.ts";
import { NOTE_MAX, REJECT_REASONS, rejectProblem } from "../lib/feedback.ts";
import { exportFilename } from "../lib/format.ts";
import { friendlyError } from "../lib/rules.ts";

export default function MatchActions({ id, status, onChanged }: { id: string; status: string; onChanged?: () => void }) {
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const problem = rejectProblem(reason, note);

  const run = async (fn: () => Promise<string>) => {
    setPending(true);
    setMsg(null);
    try {
      const text = await fn();
      setMsg({ ok: true, text });
      setRejecting(false);
      setReason("");
      setNote("");
      onChanged?.();
    } catch (e) {
      setMsg({ ok: false, text: friendlyError(e) });
    } finally {
      setPending(false);
    }
  };

  const doExport = () =>
    run(async () => {
      const json = await matchExport(id);
      downloadJson(json, exportFilename(id));
      return "Sent to CRM — the file has been downloaded.";
    });

  return (
    <div className="actions">
      <div className="action-row">
        {status !== "shortlisted" && (
          <button className="btn" disabled={pending} onClick={() => run(async () => (await matchDecide(id, "shortlist"), "Shortlisted."))}>
            Shortlist
          </button>
        )}
        {status !== "rejected" && (
          <button className="btn" disabled={pending} onClick={() => setRejecting((v) => !v)} aria-expanded={rejecting}>
            Reject…
          </button>
        )}
        {status !== "proposed" && (
          <button
            className="btn ghost"
            disabled={pending}
            onClick={() => run(async () => (await matchDecide(id, "reopen"), "Reopened — it is back with the new matches."))}
            title="Puts it back to New so you can decide again"
          >
            Reopen
          </button>
        )}
        <button className="btn primary" disabled={pending} onClick={doExport} title="Downloads a file for your CRM">
          {status === "sent_to_crm" ? "Download again" : "Send to CRM"}
        </button>
      </div>
      {rejecting && (
        <form
          className="reject-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (problem) return;
            void run(async () => (await matchReject(id, reason, note), "Rejected. The engine will learn from this."));
          }}
        >
          <label className="field">
            <span>Reason</span>
            <select value={reason} onChange={(e) => setReason(e.target.value)} required>
              <option value="">Pick a reason…</option>
              {REJECT_REASONS.map((r) => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
          </label>
          <label className="field grow">
            <span>Note {reason === "other" ? "(needed for Other)" : "(optional)"}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} placeholder="e.g. Site already sold" />
          </label>
          <button className="btn danger" type="submit" disabled={pending || problem !== null} title={problem ?? undefined}>
            Confirm reject
          </button>
          <p className="muted small reject-hint">
            Kept for the engine to learn from: it stops proposing this organisation for this mandate, and lowers
            similar matches you reject more than once for the same reason.
          </p>
        </form>
      )}
      {pending && <p className="muted small">Saving…</p>}
      {msg && !pending && <p className={msg.ok ? "ok small" : "error small"} role="status">{msg.text}</p>}
    </div>
  );
}
