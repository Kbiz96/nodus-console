import { useEffect, useState } from "react";

interface ToastMsg { id: number; text: string; ok: boolean }
let next = 1;

/** Show a short message at the bottom of the screen. */
export function toast(text: string, ok = true): void {
  window.dispatchEvent(new CustomEvent<ToastMsg>("nodus-toast", { detail: { id: next++, text, ok } }));
}

export function Toaster() {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  useEffect(() => {
    let timer = 0;
    const on = (e: Event) => {
      const m = (e as CustomEvent<ToastMsg>).detail;
      setMsg(m);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMsg(null), 5000);
    };
    window.addEventListener("nodus-toast", on);
    return () => {
      window.removeEventListener("nodus-toast", on);
      window.clearTimeout(timer);
    };
  }, []);
  return (
    <div className="toast-zone" role="status" aria-live="polite">
      {msg && (
        <div key={msg.id} className={msg.ok ? "toast" : "toast bad"}>
          <span>{msg.text}</span>
          <button type="button" className="link-btn" onClick={() => setMsg(null)} aria-label="Close message">Close</button>
        </div>
      )}
    </div>
  );
}
