import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase.ts";
import { fmtNumber } from "../lib/format.ts";
import { Icon, Logo, type IconName } from "./Brand.tsx";

interface Item { to: string; label: string; icon: IconName; end?: boolean }
const GROUPS: { name: string; items: Item[] }[] = [
  {
    name: "Command",
    items: [
      { to: "/", label: "Today", icon: "today", end: true },
      { to: "/engine", label: "Engine", icon: "engine" },
      { to: "/map", label: "Map", icon: "map" },
    ],
  },
  {
    name: "Pipeline",
    items: [
      { to: "/matches", label: "Matches", icon: "matches" },
      { to: "/opportunities", label: "Opportunities", icon: "opportunities" },
      { to: "/mandates", label: "Mandates", icon: "mandates" },
      { to: "/deals", label: "Deals", icon: "deals" },
      { to: "/contacts", label: "Contacts", icon: "contacts" },
      { to: "/outreach", label: "Outreach", icon: "outreach" },
    ],
  },
  {
    name: "Intelligence",
    items: [
      { to: "/signals", label: "Signals", icon: "signals" },
      { to: "/sources", label: "Sources", icon: "sources" },
      { to: "/spend", label: "Spend", icon: "spend" },
    ],
  },
];
const ALL = GROUPS.flatMap((g) => g.items);
const TABS: Item[] = [ALL[0], ALL[1], ALL[2], ALL[3]];

export default function Layout({ email, onSignOut, children }: { email: string | null; onSignOut: () => void; children: ReactNode }) {
  const location = useLocation();
  const status = useStatus(location.pathname);
  const [palette, setPalette] = useState(false);
  const [sheet, setSheet] = useState(false);
  const bleed = location.pathname === "/map";

  // "/" or Cmd/Ctrl-K opens search from anywhere (except while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => setSheet(false), [location.pathname]);

  const count = (to: string) => (to === "/" && status.drafts > 0 ? <span className="nav-count" title={`${status.drafts} drafts waiting for approval`}>{status.drafts}</span> : null);

  return (
    <div className="shell">
      <aside className="rail" aria-label="Console">
        <div className="rail-brand"><Logo sub="CONSOLE" /></div>
        <button type="button" className="rail-search" onClick={() => setPalette(true)} aria-label="Search everything">
          <Icon.search />
          <span>Search</span>
          <kbd>/</kbd>
        </button>
        <nav className="rail-nav" aria-label="Main">
          {GROUPS.map((g) => (
            <div key={g.name} className="rail-group">
              <span>{g.name}</span>
              {g.items.map((i) => {
                const Ic = Icon[i.icon];
                return (
                  <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? "active" : undefined)}>
                    <Ic />
                    {i.label}
                    {count(i.to)}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="rail-foot">
          {email && <span className="who" title={email}>{email}</span>}
          <button type="button" className="link-btn" onClick={onSignOut} title={email ? `Signed in as ${email}` : undefined}>Sign out</button>
        </div>
      </aside>

      <header className="mtop">
        <Logo />
        <button type="button" className="icon-btn" onClick={() => setPalette(true)} aria-label="Search">
          <Icon.search />
        </button>
      </header>

      <div className="main-col">
        <StatusStrip s={status} />
        <main className={bleed ? "container bleed" : "container"} key={location.pathname}>{children}</main>
        {!bleed && (
          <footer className="footer">
            <span>Nodus Partners. Private. Nothing is sent without your approval.</span>
            <Link to="/import">Import</Link>
            <span>UK time</span>
          </footer>
        )}
      </div>

      <nav className="mnav" aria-label="Main (phone)">
        {TABS.map((i) => {
          const Ic = Icon[i.icon];
          return (
            <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? "active" : undefined)}>
              <Ic />
              {i.label}
              {count(i.to)}
            </NavLink>
          );
        })}
        <button type="button" onClick={() => setSheet((v) => !v)} aria-expanded={sheet} aria-controls="more-sheet">
          <Icon.more />
          More
        </button>
      </nav>
      <div className="msheet" id="more-sheet" hidden={!sheet}>
        {GROUPS.slice(1).map((g) => (
          <div key={g.name} className="rail-group">
            <span>{g.name}</span>
            <div className="rail-nav-links">
              {g.items.map((i) => {
                const Ic = Icon[i.icon];
                return (
                  <NavLink key={i.to} to={i.to} className={({ isActive }) => (isActive ? "active" : undefined)}>
                    <Ic />
                    {i.label}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
        <div className="rail-foot">
          {email && <span className="who">{email}</span>}
          <Link to="/import">Import</Link>
          <button type="button" className="link-btn" onClick={onSignOut}>Sign out</button>
        </div>
      </div>

      {palette && <Palette onClose={() => setPalette(false)} />}
    </div>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const go = (e: FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    navigate(v ? `/search?q=${encodeURIComponent(v)}` : "/search");
    onClose();
  };
  const jumps = ALL.filter((i) => !q.trim() || i.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="palette-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="presentation">
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
        <form onSubmit={go} role="search">
          <Icon.search />
          <input ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search organisations, opportunities, signals, matches…" aria-label="Search everything" />
        </form>
        {jumps.length > 0 && (
          <div className="palette-jump">
            {jumps.map((i) => (
              <Link key={i.to} to={i.to} onClick={onClose}>{i.label}</Link>
            ))}
          </div>
        )}
        <div className="palette-hint">
          <span><kbd>Enter</kbd> search everything</span>
          <span><kbd>Esc</kbd> close</span>
          <span><kbd>/</kbd> or <kbd>Ctrl K</kbd> open</span>
        </div>
      </div>
    </div>
  );
}

// ---------- status strip ----------

interface Status {
  drafts: number;
  aiQueue: number | null;
  proposed: number | null;
  sourcesLive: number | null;
  sourcesAll: number | null;
  lastRun: string | null;
  loaded: boolean;
}

const ukTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const ukDayTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function headCount(table: string, apply: (q: ReturnType<typeof base>) => ReturnType<typeof base>): Promise<number | null> {
  return Promise.resolve(apply(base(table))).then((r) => (r.error ? null : (r.count ?? 0)), () => null);
}
function base(table: string) {
  return supabase.from(table).select("id", { count: "exact", head: true });
}

/** Counts for the strip and the drafts badge. Refreshes on page change, after outreach decisions and every two minutes. */
function useStatus(path: string): Status {
  const [s, setS] = useState<Status>({ drafts: 0, aiQueue: null, proposed: null, sourcesLive: null, sourcesAll: null, lastRun: null, loaded: false });
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    window.addEventListener("nodus-outreach-changed", bump);
    const iv = window.setInterval(bump, 120_000);
    return () => {
      window.removeEventListener("nodus-outreach-changed", bump);
      window.clearInterval(iv);
    };
  }, [bump]);
  useEffect(() => {
    let live = true;
    Promise.all([
      headCount("outreach", (q) => q.eq("status", "draft")),
      headCount("ai_tasks", (q) => q.eq("status", "pending")),
      headCount("matches", (q) => q.eq("status", "proposed")),
      headCount("sources", (q) => q.eq("enabled", true).eq("auto_disabled", false)),
      headCount("sources", (q) => q),
      Promise.resolve(supabase.from("connector_runs").select("finished_at").not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(1)).then(
        (r) => (r.error ? null : ((r.data?.[0] as { finished_at?: string } | undefined)?.finished_at ?? null)),
        () => null,
      ),
    ]).then(([drafts, aiQueue, proposed, sourcesLive, sourcesAll, lastRun]) => {
      if (live) setS({ drafts: drafts ?? 0, aiQueue, proposed, sourcesLive, sourcesAll, lastRun, loaded: true });
    });
    return () => {
      live = false;
    };
  }, [path, tick]);
  return s;
}

function StatusStrip({ s }: { s: Status }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(iv);
  }, []);
  const age = s.lastRun ? (now.getTime() - Date.parse(s.lastRun)) / 3600e3 : null;
  const state = age === null ? (s.loaded ? "down" : "stale") : age < 26 ? "" : age < 50 ? "stale" : "down";
  const title = age === null ? "No engine run recorded yet" : age < 26 ? "The engine ran in the last day" : "The engine has not run for over a day";
  return (
    <div className="strip" role="status" aria-label="Engine status">
      <Link to="/sources" className="strip-cell" title={title}>
        <span className={`live-dot ${state}`} aria-hidden />
        <span className="k">Engine</span>
        <b>{s.lastRun ? ukDayTime.format(new Date(s.lastRun)) : s.loaded ? "no runs" : "…"}</b>
      </Link>
      <Link to="/sources" className="strip-cell">
        <span className="k">Sources live</span>
        <b>{s.sourcesLive === null ? "…" : fmtNumber(s.sourcesLive)}</b>
        {s.sourcesAll !== null && <span>/ {fmtNumber(s.sourcesAll)}</span>}
      </Link>
      <Link to="/" className={`strip-cell${s.drafts > 0 ? " hot" : ""}`}>
        <span className="k">To approve</span>
        <b>{fmtNumber(s.drafts)}</b>
      </Link>
      <Link to="/engine" className="strip-cell">
        <span className="k">New matches</span>
        <b>{s.proposed === null ? "…" : fmtNumber(s.proposed)}</b>
      </Link>
      <Link to="/" className="strip-cell">
        <span className="k">AI queue</span>
        <b>{s.aiQueue === null ? "…" : fmtNumber(s.aiQueue)}</b>
      </Link>
      <span className="strip-cell strip-clock" title="UK time">
        <span className="k">UK</span>
        <b>{ukTime.format(now)}</b>
      </span>
    </div>
  );
}
