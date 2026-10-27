// Pure rules behind nodus-apollo's Find and New opportunity: mandate rails -> Apollo filters, scoring each result
// against the rails, and parsing a plain-English opportunity into a mandate card. No Deno or network code here,
// so the console's unit tests import this file directly.

export type SeqKey = "capital" | "compute" | "land" | "equipment";

export interface Criteria {
  min_ticket_usd?: number; max_ticket_usd?: number; fund_min_usd?: number; fund_max_usd?: number;
  region_pref?: string[]; class?: string[]; exclude?: string[]; offtake_mw_min?: number; offtake_mw_max?: number;
  mw_min?: number; [k: string]: unknown;
}
export interface Icp { who?: string[]; signals?: string[]; disqualify?: string[]; titles?: string[]; approach?: string; [k: string]: unknown }

// ---------- regions ----------

const COUNTRY: Record<string, string[]> = {
  SA: ["Saudi Arabia"], JO: ["Jordan"], AE: ["United Arab Emirates"], QA: ["Qatar"], KW: ["Kuwait"], BH: ["Bahrain"],
  OM: ["Oman"], EG: ["Egypt"], DE: ["Germany"], AT: ["Austria"], CH: ["Switzerland"], NL: ["Netherlands"],
  GB: ["United Kingdom"], UK: ["United Kingdom"], US: ["United States"], FR: ["France"], IT: ["Italy"], ES: ["Spain"],
  IE: ["Ireland"], BE: ["Belgium"], PL: ["Poland"], PT: ["Portugal"], LU: ["Luxembourg"], SE: ["Sweden"], NO: ["Norway"],
  FI: ["Finland"], DK: ["Denmark"], IS: ["Iceland"], CA: ["Canada"], SG: ["Singapore"],
  NORDICS: ["Norway", "Sweden", "Finland", "Denmark", "Iceland"],
  GCC: ["United Arab Emirates", "Saudi Arabia", "Qatar", "Kuwait", "Bahrain", "Oman"],
  MENA: ["United Arab Emirates", "Saudi Arabia", "Qatar", "Kuwait", "Bahrain", "Oman", "Jordan", "Egypt"],
  EU: ["Europe"], EUROPE: ["Europe"], DACH: ["Germany", "Austria", "Switzerland"],
};

/** region_pref codes ("SA", "EU", "Nordics") -> Apollo location names. Unknown codes pass through as written. */
export function regionLocations(codes: string[] | undefined): string[] {
  return [...new Set((codes ?? []).flatMap((c) => COUNTRY[String(c).toUpperCase()] ?? [String(c)]))];
}

const REGION_WORDS: [RegExp, string[]][] = [
  [/\b(mena|middle east)\b/i, ["SA", "AE", "QA", "KW", "BH", "OM", "JO", "EG"]],
  [/\b(gcc|gulf)\b/i, ["SA", "AE", "QA", "KW", "BH", "OM"]],
  [/\b(saudi|ksa|riyadh)\b/i, ["SA"]], [/\b(uae|dubai|abu dhabi)\b/i, ["AE"]], [/\bqatar\b/i, ["QA"]],
  [/\bjordan\b/i, ["JO"]], [/\b(uk|united kingdom|britain|england|scotland|london)\b/i, ["GB"]],
  [/\b(us|usa|united states|america|texas)\b/i, ["US"]], [/\b(nordics?|scandinavia)\b/i, ["Nordics"]],
  [/\b(germany|german)\b/i, ["DE"]], [/\b(dach)\b/i, ["DE", "AT", "CH"]], [/\b(switzerland|swiss)\b/i, ["CH"]],
  [/\b(norway|norwegian)\b/i, ["NO"]], [/\b(sweden|swedish)\b/i, ["SE"]], [/\b(finland|finnish)\b/i, ["FI"]],
  [/\b(netherlands|dutch)\b/i, ["NL"]], [/\b(europe|european|eu)\b/i, ["EU"]],
];
export function regionCodes(text: string): string[] {
  return [...new Set(REGION_WORDS.filter(([re]) => re.test(text)).flatMap(([, c]) => c))];
}

// ---------- titles and organisation types ----------

/** "Head of Infrastructure / Digital Infrastructure" -> two titles; "CIO (family office)" -> "CIO". */
export function icpTitles(titles: string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of titles ?? []) {
    const t = raw.replace(/\([^)]*\)/g, "").trim();
    const parts = t.split(/\s*\/\s*/).filter(Boolean);
    const lead = parts[0] ?? "";
    const prefix = lead.match(/^(Head of|VP|Director of|Chief)\s+/i)?.[0] ?? "";
    parts.forEach((p, i) => out.push(i > 0 && prefix && !p.toLowerCase().startsWith(prefix.trim().toLowerCase()) ? `${prefix}${p}` : p));
  }
  return [...new Set(out.map((s) => s.trim()).filter(Boolean))].slice(0, 12);
}

export const DEFAULT_TITLES: Record<SeqKey, string[]> = {
  capital: ["Managing Director", "Partner", "Chief Investment Officer", "Head of Infrastructure", "Head of Private Markets"],
  compute: ["CTO", "VP Infrastructure", "Head of Procurement", "Head of Capacity"],
  land: ["CEO", "Development Director", "Head of Development", "Head of Site Selection"],
  equipment: ["Head of Procurement", "COO", "Procurement Director"],
};

/** mandates.criteria.class values -> Apollo organisation keyword tags. */
const CLASS_TAGS: Record<string, string[]> = {
  sovereign: ["sovereign wealth fund"], quasi_sovereign: ["sovereign wealth fund", "investment holding"],
  large_family_office: ["family office"], family_office: ["family office"],
  infra_fund: ["infrastructure fund", "infrastructure investment"], growth_infra_fund: ["infrastructure fund", "growth equity"],
  dc_platform_investor: ["data center investment", "digital infrastructure"], pension: ["pension fund"],
  private_equity: ["private equity"], strategic: [],
  neocloud: ["gpu cloud", "ai cloud", "cloud computing"], gpu_operator: ["gpu cloud"], ai_lab: ["artificial intelligence"],
  sovereign_ai: ["sovereign ai"], hyperscaler_capacity: ["cloud computing", "hyperscale"], large_enterprise: [], enterprise: [],
  dc_operator: ["data center"], mid_market_developer: ["data center development"],
};
export const INVESTOR_TAGS = ["infrastructure fund", "private equity", "sovereign wealth fund", "pension fund", "family office", "infrastructure investment"];

export function classTags(classes: string[] | undefined, line: SeqKey): string[] {
  const tags = [...new Set((classes ?? []).flatMap((c) => CLASS_TAGS[c] ?? [c.replace(/_/g, " ")]))];
  if (tags.length) return tags.slice(0, 10);
  return line === "capital" ? INVESTOR_TAGS : [];
}

// ---------- size proxies ----------

/** Apollo has no fund-size filter. Headcount is the proxy: big funds employ people. Returns Apollo employee ranges or []. */
export function headcountRanges(c: Criteria, line: SeqKey): string[] {
  const fundMin = Number(c.fund_min_usd ?? 0);
  const ticketMin = Number(c.min_ticket_usd ?? 0);
  const fundMax = Number(c.fund_max_usd ?? 0);
  if (line !== "capital") return [];
  let lo = 0;
  if (fundMin >= 1e9 || ticketMin >= 100e6) lo = 51;
  else if (fundMin >= 100e6 || ticketMin >= 10e6) lo = 11;
  const hi = fundMax > 0 && fundMax <= 1e9 ? 500 : 0;
  if (!lo && !hi) return [];
  const all: [number, number][] = [[1, 10], [11, 20], [21, 50], [51, 100], [101, 200], [201, 500], [501, 1000], [1001, 2000], [2001, 5000], [5001, 10000], [10001, 1000000]];
  return all.filter(([a, b]) => a >= (lo || 1) && (!hi || b <= hi)).map(([a, b]) => `${a},${b}`);
}

export interface Org {
  id?: string; name?: string; primary_domain?: string; estimated_num_employees?: number; annual_revenue?: number;
  annual_revenue_printed?: string; industry?: string; keywords?: string[]; country?: string;
}

/** What Apollo tells us about scale, and whether it meets the mandate's size rail. */
export function sizeEvidence(o: Org | undefined, c: Criteria, line: SeqKey): { text: string; meets: boolean | null } {
  const emp = o?.estimated_num_employees ?? null;
  const rev = o?.annual_revenue_printed ?? (o?.annual_revenue ? `$${Math.round(o.annual_revenue / 1e6)}m` : null);
  const bits = [emp ? `${emp} employees` : null, rev ? `revenue ${rev}` : null, o?.industry ?? null].filter(Boolean);
  const ranges = headcountRanges(c, line);
  let meets: boolean | null = null;
  if (emp && ranges.length) {
    meets = ranges.some((r) => { const [a, b] = r.split(",").map(Number); return emp >= a && emp <= b; });
  }
  const fund = c.fund_min_usd ? `fund size vs $${fmtUsd(c.fund_min_usd)}+ unverified` : c.min_ticket_usd && line === "capital" ? `ticket $${fmtUsd(c.min_ticket_usd)}+ unverified` : null;
  const mw = c.offtake_mw_min || c.offtake_mw_max ? `offtake ${c.offtake_mw_min ?? "?"}-${c.offtake_mw_max ?? "?"} MW unverified` : null;
  const proxy = bits.length ? `${bits.join(", ")} (Apollo)` : "unverified: no size data in Apollo";
  return { text: [proxy, fund, mw].filter(Boolean).join("; "), meets };
}
function fmtUsd(n: number): string {
  return n >= 1e9 ? `${+(n / 1e9).toFixed(1)}bn` : `${Math.round(n / 1e6)}m`;
}

// ---------- exclude / disqualify ----------

const EXCLUDE_RULES: [RegExp, RegExp][] = [
  // [rule text that names it, what in the organisation or title gives it away]
  [/\b(pure_lender|lenders? only|lender|debt only)\b/i, /\b(lend|lender|lending|debt|credit fund|private credit|mortgage)\b/i],
  [/\bbank\b/i, /\bbank(ing)?\b/i],
  [/\b(reseller|resellers)\b/i, /\b(resell|reseller|distributor)\b/i],
  [/\b(mega funds?)\b/i, /$^/], // handled by headcount below
];

/** Which exclude/disqualify rule this result breaks, or null. Only rules Apollo data can show are applied. */
export function hitsExclusion(rules: string[], text: string, employees: number | null | undefined): string | null {
  for (const rule of rules) {
    for (const [ruleRe, orgRe] of EXCLUDE_RULES) {
      if (ruleRe.test(rule) && orgRe.test(text)) return rule;
    }
    if (/\bmega funds?\b/i.test(rule) && (employees ?? 0) > 1000) return rule;
  }
  return null;
}

// ---------- scoring ----------

export interface Rails { titles: string[]; locations: string[]; tags: string[]; criteria: Criteria; line: SeqKey; rules: string[] }

export interface Scored { rails: string[]; fit_score: number; size_evidence: string; excluded: string | null }

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

/** Scores one Apollo person + organisation against the mandate's rails. */
export function scoreResult(p: { title?: string | null; country?: string | null }, o: Org | undefined, r: Rails): Scored {
  const rails: string[] = [];
  let score = 40;
  const title = (p.title ?? "").toLowerCase();
  const tHit = r.titles.find((t) => { const w = tokens(t).filter((x) => !["of", "and", "the", "head"].includes(x)); return w.length > 0 && w.every((x) => title.includes(x)); });
  if (tHit) { rails.push(`title: ${tHit}`); score += 20; }
  const where = [p.country, o?.country].filter(Boolean) as string[];
  const locs = r.locations.filter((l) => l !== "Europe");
  const inRegion = where.find((w) => locs.some((l) => l.toLowerCase() === w.toLowerCase()));
  if (inRegion) { rails.push(`region: ${inRegion}`); score += 15; } else if (r.locations.length && where.length === 0) rails.push("region: unverified");
  const orgText = [o?.name, o?.industry, ...(o?.keywords ?? [])].filter(Boolean).join(" ").toLowerCase();
  const tag = r.tags.find((t) => orgText.includes(t.toLowerCase()));
  if (tag) { rails.push(`type: ${tag}`); score += 15; }
  const size = sizeEvidence(o, r.criteria, r.line);
  if (size.meets === true) { rails.push("size: headcount proxy met"); score += 10; }
  if (size.meets === false) score -= 10;
  const excluded = hitsExclusion(r.rules, `${orgText} ${title}`, o?.estimated_num_employees);
  return { rails, fit_score: Math.max(0, Math.min(100, score)), size_evidence: size.text, excluded };
}

// ---------- line from text ----------

export function lineOf(text: string, mandateLine?: string | null): SeqKey {
  if (mandateLine === "capital") return "capital";
  if (mandateLine === "powered_land") return "land";
  if (mandateLine === "critical_power") return "equipment";
  if (mandateLine === "compute") return "compute";
  const t = text.toLowerCase();
  if (/\b(investor|investors|capital|fund|funds|equity|lp|lps|financing|co-invest|family offices?)\b/.test(t)) return "capital";
  if (/\b(site|sites|land|powered[- ]shell|developer|developers|campus)\b/.test(t)) return "land";
  if (/\b(genset|gensets|turbine|turbines|equipment|rfq|procurement)\b/.test(t)) return "equipment";
  return "compute";
}

// ---------- New opportunity ----------

export type OppKind = "site" | "capital_ask" | "need" | "investor_mandate";

const MONEY = /([$€£])?\s*(\d+(?:\.\d+)?)\s*(?:[-–to]+\s*([$€£])?\s*(\d+(?:\.\d+)?))?\s*(k|m|mn|million|bn|b|billion)\b/i;
const MW = /(\d+(?:\.\d+)?)\s*(?:[-–to]+\s*(\d+(?:\.\d+)?))?\s*mw\b/i;

function scale(unit: string): number {
  const u = unit.toLowerCase();
  return u.startsWith("b") ? 1e9 : u === "k" ? 1e3 : 1e6;
}

/** Simple rules, no AI: the kind, the line and any sizes and regions in Kuran's sentence. */
export function parseOpportunity(text: string): { kind: OppKind; line: string; side: "supply" | "need"; criteria: Criteria } {
  const t = text.toLowerCase();
  let kind: OppKind;
  if (/\b(raising|raise|needs? (capital|funding|equity|investment|investors)|looking for (investors|capital|funding|equity)|equity ask|seeking (capital|investment|funding))\b/.test(t)) kind = "capital_ask";
  else if (/\b(wants to invest|looking to invest|deploy(ing)?|mandate to invest|investor mandate|family office|fund (is )?looking|ticket|aum)\b/.test(t)) kind = "investor_mandate";
  else if (/\b(site|land|acres?|hectares?|plot|powered shell|campus|substation|grid connection)\b/.test(t) && !/\b(needs?|looking for|wants?|seeking)\b[^.]{0,30}\b(site|land|campus|powered shell)\b/.test(t)) kind = "site";
  else kind = "need";

  let line: string;
  if (kind === "capital_ask" || kind === "investor_mandate") line = "capital";
  else if (kind === "site") line = "powered_land";
  else if (/\b(genset|gensets|turbine|turbines|generator|generators|power equipment)\b/.test(t)) line = "critical_power";
  else if (/\b(site|land|campus|powered shell)\b/.test(t)) line = "powered_land";
  else line = "compute";
  const side: "supply" | "need" = kind === "site" || kind === "investor_mandate" ? "supply" : "need";

  const criteria: Criteria = { _source: "console", target_side: side === "supply" ? "need" : "supply", lines: [line] };
  const regions = regionCodes(text);
  if (regions.length) criteria.region_pref = regions;

  const fundM = t.match(/([$€£]?\s*\d+(?:\.\d+)?\s*(?:m|mn|million|bn|b|billion))\s*(?:of\s+)?(?:aum|fund size|under management)\b/i)
    ?? t.match(/(?:fund size|fund of|aum of|aum|balance sheet)\s*(?:of\s*)?([$€£]?\s*\d+(?:\.\d+)?\s*(?:m|mn|million|bn|b|billion))\b/i);
  if (fundM) {
    const f = fundM[1].match(MONEY);
    if (f) criteria.fund_min_usd = Number(f[2]) * scale(f[5]);
  }
  const rest = fundM ? t.replace(fundM[0], " ") : t;
  const m = rest.match(MONEY);
  if (m) {
    const s = scale(m[5]);
    const a = Number(m[2]) * s;
    const b = m[4] ? Number(m[4]) * s : null;
    if (kind === "capital_ask" || kind === "investor_mandate") {
      criteria.min_ticket_usd = a;
      if (b) criteria.max_ticket_usd = b;
    } else criteria.budget_usd = b ?? a;
  }
  const mw = text.match(MW);
  if (mw) {
    const a = Number(mw[1]);
    const b = mw[2] ? Number(mw[2]) : null;
    if (kind === "site") criteria.mw_min = a;
    else if (kind === "need") { criteria.offtake_mw_min = a; if (b) criteria.offtake_mw_max = b; }
    else criteria.mw_min = a;
  }
  if (kind === "investor_mandate" || kind === "capital_ask") {
    if (/\blenders? only\b|\bno lenders\b|\bequity only\b/.test(t)) criteria.exclude = ["pure_lender"];
  }
  return { kind, line, side, criteria };
}

const KIND_WORDS: Record<OppKind, string> = { site: "site", capital_ask: "capital ask", need: "need", investor_mandate: "investor mandate" };
const LINE_WORDS: Record<string, string> = { capital: "capital", powered_land: "powered land", compute: "compute", critical_power: "critical power" };

/** The next mandate code, e.g. "C37 capital ask (capital)" or "S02 site (powered land)". Codes, never names. */
export function nextLabel(existing: string[], kind: OppKind, line: string): string {
  const prefix = kind === "site" ? "S" : "C";
  let max = 0;
  for (const l of existing) {
    const m = l.match(new RegExp(`^${prefix}(\\d+)\\b`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(2, "0")} ${KIND_WORDS[kind]} (${LINE_WORDS[line] ?? line})`;
}

/** Default ICP for a console-made card, so Find has titles and Draft has an approach. Marked as a default. */
export function defaultIcp(kind: OppKind, line: string): Icp {
  // A site looks for offtakers (compute buyers); a capital ask looks for investors; an investor mandate looks for deals
  // (developers); a need looks for whoever supplies it.
  const supplier = ["Chief Commercial Officer", "VP Sales", "Head of Partnerships", "Sales Director", "CEO"];
  const titles = kind === "site" ? DEFAULT_TITLES.compute
    : kind === "capital_ask" ? DEFAULT_TITLES.capital
    : kind === "investor_mandate" ? DEFAULT_TITLES.land
    : line === "powered_land" ? DEFAULT_TITLES.land : supplier;
  return {
    titles,
    approach: line === "capital" || kind === "investor_mandate" ? "relationship first; mandate range; blind summary" : line === "critical_power" ? "procurement: RFQ" : "direct; blind specs",
    default: true,
  };
}
