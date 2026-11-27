import { useState } from "react";
import { DISMISS_KIND_LABEL, dismissalList, loadDismissals, restoreItem, statusBeforeSkip, type ConsoleDismissal } from "../lib/dismiss.ts";
import { fmtDateTime, fmtNumber } from "../lib/format.ts";
import { friendlyError } from "../lib/rules.ts";
import { useDismissed } from "../components/Dismiss.tsx";
import { toast } from "../components/Toast.tsx";
import { Loading, PageHead, useTitle } from "../components/ui.tsx";

/** Everything cleared away with X, newest first, each with Restore (and Restore all). */
export default function Dismissed() {
  useTitle("Dismissed");
  const dz = useDismissed();
  const rows = dz.ready ? dismissalList() : [];
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const bringBack = async (d: ConsoleDismissal) => {
    setBusy(d.id);
    try {
      await restoreItem(d.kind, d.ref);
      toast(`Restored ${d.label || "it"}.`);
    } catch (e) {
      toast(friendlyError(e), false);
    } finally {
      setBusy(null);
    }
  };

  const bringAllBack = async () => {
    setBusy("all");
    let n = 0;
    try {
      for (const d of rows) {
        await restoreItem(d.kind, d.ref);
        n += 1;
      }
      toast(`Restored ${fmtNumber(n)} ${n === 1 ? "item" : "items"}.`);
    } catch (e) {
      toast(`${n ? `Restored ${fmtNumber(n)}, then stopped: ` : ""}${friendlyError(e)}`, false);
    } finally {
      setBusy(null);
      setConfirm(false);
    }
  };

  return (
    <div className="stack-lg">
      <PageHead
        eyebrow="Work"
        title="Dismissed"
        actions={rows.length > 0 ? (
          <div className="action-row">
            {confirm ? (
              <>
                <button type="button" className="btn primary" disabled={busy !== null} onClick={() => void bringAllBack()}>{busy === "all" ? "Restoring…" : `Confirm: restore all ${fmtNumber(rows.length)}`}</button>
                <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => setConfirm(false)}>Cancel</button>
              </>
            ) : (
              <button type="button" className="btn" disabled={busy !== null} onClick={() => setConfirm(true)}>Restore all</button>
            )}
          </div>
        ) : undefined}
      >
        Things you cleared away with X, newest first. Restore puts one back where it was. Emails you dismissed before they were sent were skipped, so they were never sent; Restore makes them drafts again.
      </PageHead>
      {!dz.ready ? (
        <Loading what="Getting what you dismissed…" />
      ) : rows.length === 0 ? (
        <div className="stack">
          <p className="empty">Nothing dismissed. Press X on any card or row to clear it away.</p>
          <div><button type="button" className="btn small ghost" onClick={() => void loadDismissals(true)}>Check again</button></div>
        </div>
      ) : (
        <ul className="dismissed-list">
          {rows.map((d) => {
            const was = d.kind === "outreach" ? statusBeforeSkip(d.reason) : null;
            return (
              <li key={d.id}>
                <div className="dismissed-main">
                  <strong>{d.label || d.ref}</strong>
                  <p className="dismissed-meta">
                    {DISMISS_KIND_LABEL[d.kind] ?? d.kind} · dismissed {fmtDateTime(d.dismissed_at)}
                    {was && ` · skipped, was ${was === "draft" ? "a draft" : "approved"}`}
                    {!was && d.reason && ` · ${d.reason}`}
                  </p>
                </div>
                <button type="button" className="btn small" disabled={busy !== null || d.id.startsWith("pending-")} onClick={() => void bringBack(d)}>
                  {busy === d.id ? "Restoring…" : "Restore"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
