import { Link, useLocation } from "react-router-dom";

export type EngineTab = "map" | "best" | "matches" | "list";

const TABS: { key: EngineTab; label: string; to: string }[] = [
  { key: "map", label: "Map", to: "/map" },
  { key: "best", label: "Best next", to: "/engine?best=1" },
  { key: "matches", label: "Matches", to: "/engine" },
  { key: "list", label: "List", to: "/opportunities" },
];

/** Which Engine tab a route belongs to (null when it is not an Engine page). */
export function engineTabOf(path: string, search: string): EngineTab | null {
  if (path === "/map") return "map";
  if (path === "/engine") return new URLSearchParams(search).get("best") === "1" ? "best" : "matches";
  if (path === "/matches" || path.startsWith("/matches/")) return "matches";
  if (path === "/opportunities" || path.startsWith("/opportunities/")) return "list";
  return null;
}

/** The one tab bar shared by the Engine screen's four views: Map, Best next, Matches and List. */
export function EngineTabs({ className = "" }: { className?: string }) {
  const { pathname, search } = useLocation();
  const here = engineTabOf(pathname, search);
  return (
    <nav className={`tabs engine-tabs ${className}`.trim()} aria-label="Engine views">
      {TABS.map((t) => (
        <Link key={t.key} to={t.to} className={here === t.key ? "active" : undefined} aria-current={here === t.key ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
