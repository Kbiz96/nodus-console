import { useState } from "react";
import { downloadJson, matchDecide, matchExport } from "../lib/data.ts";
import { exportFilename } from "../lib/format.ts";
import { friendlyError } from "../lib/rules.ts";

export default function MatchActions({ id, status, onChanged }: { id: string; status: string; onChanged?: () => void }) {
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const run = async (fn: () => Promise<string>) => {
    setPending(true);
    setMsg(null);
    try {
      const text = await fn();
      setMsg({ ok: true, text });
      setRejecting(false);
      setReason("");
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
            void run(async () => (await matchDecide(id, "reject", reason.trim()), "Rejected."));
          }}
        >
          <label className="field grow">
            <span>Why are you rejecting this? (kept for the engine to learn from)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={2000} placeholder="e.g. Site already sold" />
          </label>
          <button className="btn danger" type="submit" disabled={pending || reason.trim().length < 3}>
            Confirm reject
          </button>
        </form>
      )}
      {pending && <p className="muted small">Saving…</p>}
      {msg && !pending && <p className={msg.ok ? "ok small" : "error small"} role="status">{msg.text}</p>}
    </div>
  );
}
