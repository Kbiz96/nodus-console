import type { ReactNode, SVGProps } from "react";
import { Link } from "react-router-dom";

/** The Nodus mark, exactly as on nodus.partners (components/logo.tsx). */
export function Mark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 31 31" fill="none" aria-hidden="true" {...props}>
      <path d="M3 5 19.5 14.5M3 26 19.5 16.5M8 2l11.5 12.5M8 29l11.5-12.5M28 4 19.5 14.5M28 27 19.5 16.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="19.5" cy="15.5" r="3.3" fill="currentColor" />
    </svg>
  );
}

export function Logo({ to = "/", sub }: { to?: string; sub?: string }) {
  return (
    <Link to={to} className="logo" aria-label="Nodus console home">
      <Mark />
      <span>NODUS</span>
      {sub && <span className="logo-sub">{sub}</span>}
    </Link>
  );
}

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "square" as const, strokeLinejoin: "miter" as const };
function I({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 20 20" aria-hidden="true" {...P}>{children}</svg>;
}

export const Icon = {
  today: () => <I><rect x="3" y="3" width="6" height="6" /><rect x="11" y="3" width="6" height="6" /><rect x="3" y="11" width="6" height="6" /><path d="M11 14h6M14 11v6" /></I>,
  engine: () => <I><circle cx="4" cy="5" r="1.6" /><circle cx="4" cy="15" r="1.6" /><circle cx="16" cy="10" r="2.2" /><path d="M5.5 5.6 13.9 9.3M5.5 14.4l8.4-3.7" /></I>,
  map: () => <I><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c-2.6 2.2-2.6 11.8 0 14M10 3c2.6 2.2 2.6 11.8 0 14" /></I>,
  matches: () => <I><circle cx="6" cy="10" r="3.2" /><circle cx="14" cy="10" r="3.2" /></I>,
  opportunities: () => <I><circle cx="10" cy="10" r="6.5" /><circle cx="10" cy="10" r="2.5" /><path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" /></I>,
  mandates: () => <I><path d="M5 2.5h7l3 3v12H5z" /><path d="M8 9h4M8 12h4" /></I>,
  deals: () => <I><rect x="2.5" y="6" width="15" height="10" /><path d="M7 6V3.5h6V6M2.5 10.5h15" /></I>,
  contacts: () => <I><circle cx="10" cy="7" r="3.2" /><path d="M3.5 17.5c.8-3.3 3.3-5 6.5-5s5.7 1.7 6.5 5" /></I>,
  outreach: () => <I><path d="M2.5 9.5 17.5 3l-5 14.5-3-6z" /><path d="M9.5 11.5l8-8.5" /></I>,
  signals: () => <I><path d="M2 10h3l2-5 3 10 2.5-7 1.5 2H18" /></I>,
  sources: () => <I><ellipse cx="10" cy="4.5" rx="6.5" ry="2" /><path d="M3.5 4.5v11c0 1.1 2.9 2 6.5 2s6.5-.9 6.5-2v-11M3.5 10c0 1.1 2.9 2 6.5 2s6.5-.9 6.5-2" /></I>,
  spend: () => <I><circle cx="10" cy="10" r="7" /><path d="M12.5 7c-.5-1-1.4-1.5-2.6-1.5-1.5 0-2.4.8-2.4 1.9 0 2.6 5.2 1.4 5.2 4.2 0 1.2-1 2-2.7 2-1.3 0-2.3-.6-2.8-1.6M10 4v1.5M10 14.5V16" /></I>,
  search: () => <I><circle cx="8.5" cy="8.5" r="5.5" /><path d="m12.5 12.5 5 5" /></I>,
  more: () => <I><path d="M3 5h14M3 10h14M3 15h14" /></I>,
  import: () => <I><path d="M10 2.5v10M6 8.5l4 4 4-4M3 14.5v3h14v-3" /></I>,
  close: () => <I><path d="m5 5 10 10M15 5 5 15" /></I>,
  focus: () => <I><circle cx="10" cy="10" r="7" /><circle cx="10" cy="10" r="3" /><circle cx="10" cy="10" r=".6" fill="currentColor" /></I>,
  review: () => <I><rect x="4" y="5" width="12" height="12" /><path d="M6.5 2.5h9.5V14" /><path d="m7 11 2 2 4-4" /></I>,
  priorities: () => <I><path d="M7 5h10M7 10h10M7 15h10" /><path d="M3 4.2h1.2v1.6M3 9.2h1.2v1.6M3 14.2h1.2v1.6" /></I>,
  pencil: () => <I><path d="M13.5 3.5l3 3L7 16H4v-3z" /><path d="M11.5 5.5l3 3" /></I>,
  up: () => <I><path d="M10 16V4M5 9l5-5 5 5" /></I>,
  chevron: () => <I><path d="m5 8 5 5 5-5" /></I>,
  down: () => <I><path d="M10 4v12M5 11l5 5 5-5" /></I>,
  calm: () => <I><path d="M3 8c2-2 4-2 7 0s5 2 7 0M3 13c2-2 4-2 7 0s5 2 7 0" /></I>,
  claude: () => <I><path d="M10 2.5v4M10 13.5v4M2.5 10h4M13.5 10h4M4.7 4.7l2.8 2.8M12.5 12.5l2.8 2.8M15.3 4.7l-2.8 2.8M7.5 12.5l-2.8 2.8" /></I>,
  linkedin: () => <I><rect x="3" y="3" width="14" height="14" /><path d="M6.5 9v5M6.5 6.3v.4M9.5 14V9M9.5 11.2c0-1.4.9-2.2 2-2.2s2 .7 2 2.2V14" /></I>,
  check: () => <I><path d="m4.5 10.5 3.5 3.5 7.5-8" /></I>,
  external: () => <I><path d="M11 3h6v6M17 3l-8 8M14 12v5H3V6h5" /></I>,
};
export type IconName = keyof typeof Icon;
