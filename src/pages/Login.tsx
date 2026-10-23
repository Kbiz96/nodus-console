import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase.ts";
import { useTitle } from "../components/ui.tsx";
import { Logo } from "../components/Brand.tsx";

export default function Login() {
  useTitle("Sign in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState(false);

  // Forgotten password: email a one-click sign-in link. Only existing approved users get one (no sign-ups).
  const sendLink = async () => {
    if (!email.trim()) {
      setError("Enter your email address first, then press the link button.");
      return;
    }
    setPending(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + window.location.pathname },
    });
    setPending(false);
    if (error) {
      setError(/rate|too many/i.test(error.message)
        ? "A link was sent very recently. Please wait a few minutes and check your inbox."
        : /signups? not allowed|not found/i.test(error.message)
          ? "That email address doesn't have access to this page."
          : error.message);
    } else {
      setLinkSent(true);
    }
  };

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
        <Logo />
        <h1>Origination console</h1>
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
        <button className="btn" type="button" onClick={sendLink} disabled={pending}>
          Forgot password? Email me a sign-in link
        </button>
        {linkSent && (
          <p className="muted" role="status">
            Sent. Open the email from Supabase and tap the link; it signs you straight in.
          </p>
        )}
      </div>
    </div>
  );
}
