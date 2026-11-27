import { useEffect, useState } from "react";
import {
  dismiss, dismissKey, dismissalsReady, dismissedKeys, dismissOutreach, loadDismissals, onDismissalsChanged, restoreItem, skipsOnDismiss,
  type DismissKind,
} from "../lib/dismiss.ts";
import { friendlyError } from "../lib/rules.ts";
import { Icon } from "./Brand.tsx";
import { toast } from "./Toast.tsx";

/** The dismissed set, loaded once per session; re-renders when anything is dismissed or restored. */
export function useDismissed(): { ready: boolean; keys: ReadonlySet<string>; is: (kind: DismissKind, ref: string | null | undefined) => boolean } {
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => dismissedKeys());
  const [ready, setReady] = useState(() => dismissalsReady());
  useEffect(() => {
    const sync = () => { setKeys(dismissedKeys()); setReady(dismissalsReady()); };
    const off = onDismissalsChanged(sync);
    loadDismissals().then(sync, () => setReady(true));
    return off;
  }, []);
  return { ready, keys, is: (kind, ref) => Boolean(ref && keys.has(dismissKey(kind, ref))) };
}

/** The X on a card or row: quiet until hovered or focused. */
export function DismissButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button type="button" className={`x-dismiss ${className}`.trim()} aria-label="Dismiss" title="Dismiss" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}>
      <Icon.close />
    </button>
  );
}

/**
 * Dismiss one item, with Undo for a few seconds. For an email or LinkedIn message pass `outreach` (its id and
 * status): a draft or approved one is also skipped so it is never sent. Everything else is only hidden.
 */
export async function dismissWithUndo(kind: DismissKind, ref: string, label: string, opts: { status?: string | null; onChange?: () => void } = {}): Promise<void> {
  const skipped = kind === "outreach" && skipsOnDismiss(opts.status);
  try {
    if (kind === "outreach") await dismissOutreach({ id: ref, status: opts.status ?? "" }, label);
    else await dismiss(kind, ref, label);
    opts.onChange?.();
    toast(skipped ? "Dismissed. It won't be sent. Find it under More, Dismissed." : "Dismissed. Find it under More, Dismissed.", true, {
      ms: 8000,
      actions: [{
        label: "Undo",
        primary: true,
        run: () => {
          void restoreItem(kind, ref).then(
            () => { opts.onChange?.(); toast("Undone. It's back."); },
            (e) => toast(friendlyError(e), false),
          );
        },
      }],
    });
  } catch (e) {
    toast(friendlyError(e), false);
  }
}
