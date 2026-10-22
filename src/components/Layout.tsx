import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { supabase } from "../lib/supabase.ts";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";

const ITEMS = [
  { to: "/", label: "Today", end: true },
  { to: "/contacts", label: "Contacts" },
  { to: "/deals", label: "Deals" },
  { to: "/outreach", label: "Outreach" },
  { to: "/matches", label: "Matches" },
  { to: "/opportunities", label: "Opportunities" },
  { to: "/mandates", label: "Mandates" },
  { to: "/signals", label: "Signals" },
  { to: "/sources", label: "Sources" },
  { to: "/spend", label: "Spend" },
  { to: "/search", label: "Search" },
];

export default function Layout({ email, onSignOut, children }: { email: string | null; onSignOut: () => void; children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState("");
  const drafts = useDraftCount(location.pathname);
  const search = (e: FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    navigate(v ? `/search?q=${encodeURIComponent(v)}` : "/search");
    setQ("");
  };
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden>N</span>
            <span>Nodus</span>
          </Link>
          <form onSubmit={search} className="search-box" role="search">
            <input type="search" name="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everything…" aria-label="Search everything" />
            <button type="submit" className="btn small">Search</button>
          </form>
          <button type="button" className="link-btn" onClick={onSignOut} title={email ? `Signed in as ${email}` : undefined}>
            Sign out
          </button>
        </div>
        <nav className="nav" aria-label="Main">
          {ITEMS.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? "active" : undefined)}>
              {i.label}
              {i.to === "/" && drafts > 0 && <span className="nav-count" title={`${drafts} drafts waiting for approval`}>{drafts}</span>}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="container" key={location.pathname}>{children}</main>
      <footer className="footer">
        Nodus Partners — private. Nothing is sent without your approval. · <Link to="/import">Import</Link>
      </footer>
    </>
  );
}

/** Drafts waiting for approval, for the badge on Today. Refreshes on page change and after any outreach decision. */
function useDraftCount(path: string): number {
  const [n, setN] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener("nodus-outreach-changed", bump);
    return () => window.removeEventListener("nodus-outreach-changed", bump);
  }, []);
  useEffect(() => {
    let live = true;
    supabase
      .from("outreach")
      .select("id", { count: "exact", head: true })
      .eq("status", "draft")
      .then((r) => {
        if (live && !r.error) setN(r.count ?? 0);
      });
    return () => {
      live = false;
    };
  }, [path, tick]);
  return n;
}
