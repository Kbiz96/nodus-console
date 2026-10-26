import { useEffect, useState } from "react";

export interface ToastAction {
  label: string;
  run: () => void;
  /** Closes the message after running (default true). */
  close?: boolean;
  /** The main action, e.g. Undo. Others are drawn quieter. */
  primary?: boolean;
}
interface ToastMsg { id: number; text: string; ok: boolean; actions: ToastAction[]; ms: number }
let next = 1;

/** Show a short message at the bottom of the screen, optionally with buttons such as Undo. */
export function toast(text: string, ok = true, opts: { actions?: ToastAction[]; ms?: number } = {}): void {
  const detail: ToastMsg = { id: next++, text, ok, actions: opts.actions ?? [], ms: opts.ms ?? 5000 };
  window.dispatchEvent(new CustomEvent<ToastMsg>("nodus-toast", { detail }));
}

export function Toaster() {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  useEffect(() => {
    const on = (e: Event) => setMsg((e as CustomEvent<ToastMsg>).detail);
    window.addEventListener("nodus-toast", on);
    return () => window.removeEventListener("nodus-toast", on);
  }, []);
  useEffect(() => {
    if (!msg) return;
    const timer = window.setTimeout(() => setMsg((m) => (m?.id === msg.id ? null : m)), msg.ms);
    return () => window.clearTimeout(timer);
  }, [msg]);
  return (
    <div className="toast-zone" role="status" aria-live="polite">
      {msg && (
        <div key={msg.id} className={`${msg.ok ? "toast" : "toast bad"}${msg.actions.length ? " has-actions" : ""}`}>
          <span className="toast-text">{msg.text}</span>
          <span className="toast-acts">
            {msg.actions.map((a) => (
              <button
                key={a.label}
                type="button"
                className={a.primary ? "toast-act primary" : "toast-act"}
                onClick={() => {
                  a.run();
                  if (a.close !== false) setMsg(null);
                }}
              >
                {a.label}
              </button>
            ))}
            <button type="button" className="link-btn" onClick={() => setMsg(null)} aria-label="Close message">Close</button>
          </span>
        </div>
      )}
    </div>
  );
}
