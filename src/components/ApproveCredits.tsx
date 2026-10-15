import { useState } from "react";
import { enrichApprove } from "../lib/data.ts";
import { friendlyError } from "../lib/rules.ts";

/** Kuran's OK for one enrichment request to go over a credit cap. The database checks it (1–200 credits). */
export default function ApproveCredits({ id, credits, onDone }: { id: string; credits: number; onDone?: () => void }) {
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const approve = async () => {
    setPending(true);
    setMsg(null);
    try {
      await enrichApprove(id, credits);
      setMsg({ ok: true, text: "Approved. It will run at the next enrichment run." });
      onDone?.();
    } catch (e) {
      setMsg({ ok: false, text: friendlyError(e) });
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="action-row">
      <button className="btn primary small" disabled={pending || msg?.ok === true} onClick={approve}>
        Approve {credits} credits
      </button>
      {pending && <span className="muted small">Saving…</span>}
      {msg && !pending && <span className={msg.ok ? "ok small" : "error small"} role="status">{msg.text}</span>}
    </div>
  );
}
