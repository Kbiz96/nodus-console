import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase.ts";
import { useTitle } from "../components/ui.tsx";
import { Logo } from "../components/Brand.tsx";

// Set a new console password. Shown after a password-reset email link (recovery) and from "Change password".
// The password goes straight to Supabase Auth; nothing is stored or logged by the console.
export const MIN_PASSWORD = 12;

export function passwordProblem(pw: string, confirm: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return "Use upper and lower case letters and at least one number.";
  if (pw !== confirm) return "The two passwords don't match.";
  return null;
}

export default function SetPassword({ onDone, recovery }: { onDone: () => void; recovery: boolean }) {
  useTitle(recovery ? "Set a new password" : "Change password");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(pw, confirm);
    if (problem) return setError(problem);
    setPending(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPending(false);
    if (error) {
      setError(/same/i.test(error.message) ? "That is your current password. Choose a new one."
        : /weak|pwned|leaked/i.test(error.message) ? "That password is too easy to guess. Choose another."
        : /reauth|recent/i.test(error.message) ? "For safety, sign out, sign in again, then change your password."
        : error.message);
      return;
    }
    setPw("");
    setConfirm("");
    setDone(true);
  };

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <Logo />
        <h1>{recovery ? "Set a new password" : "Change password"}</h1>
        {done ? (
          <>
            <p role="status">Password saved. Use it next time you sign in.</p>
            <button className="btn primary" type="button" onClick={onDone}>Continue to the console</button>
          </>
        ) : (
          <form onSubmit={submit} className="stack">
            <p className="muted small">At least {MIN_PASSWORD} characters, with upper and lower case letters and a number.</p>
            <label className="field">
              <span>New password</span>
              <input type="password" name="new-password" autoComplete="new-password" required autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
            </label>
            <label className="field">
              <span>Type it again</span>
              <input type="password" name="confirm-password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Save password"}</button>
            {!recovery && <button className="btn ghost" type="button" onClick={onDone}>Cancel</button>}
          </form>
        )}
      </div>
    </div>
  );
}
