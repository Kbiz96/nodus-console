import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase.ts";
import { useTitle } from "../components/ui.tsx";

export default function Login() {
  useTitle("Sign in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setPending(false);
    if (error) {
      setError(
        /invalid login credentials/i.test(error.message)
          ? "That email and password do not match. Please try again."
          : /email not confirmed/i.test(error.message)
            ? "This email address has not been confirmed yet."
            : /fetch|network/i.test(error.message)
              ? "Could not reach the sign-in service. Please check your internet connection."
              : error.message,
      );
    }
  };

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>Nodus Origination</h1>
        <p className="muted">Private to Nodus Partners. Please sign in.</p>
        <form onSubmit={submit} className="stack">
          <label className="field">
            <span>Email</span>
            <input type="email" name="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn primary" type="submit" disabled={pending}>
            {pending ? "Checking…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
