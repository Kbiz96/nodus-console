// Extra fake rows for the smoke test's desktop pass, so the Map and Engine views have enough to draw.
// Deterministic (seeded), shaped like the real tables; nothing here is real data.
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const hex = (n, w) => n.toString(16).padStart(w, "0");
const uuid = (prefix, n) => `${prefix}-0000-4000-8000-${hex(n, 12)}`;

const PLACES = [
  ["US", "Clark, NV"], ["US", "St. Lawrence, NY"], ["US", "Albany, NY"], ["US", "Niagara, NY"], ["US", "Cook, IL"],
  ["US", "Lancaster, NE"], ["US", "El Paso, TX"], ["US", "Dakota, MN"], ["US", "Lea, NM"], ["US", "Williams, ND"],
  ["US", "Pinellas, FL"], ["US", "Oklahoma, OK"], ["US", "PA"], ["US", null], ["US", null], ["US", null],
  ["GB", "North Yorkshire"], ["GB", "Hillingdon"], ["GB", "Slough"], ["GB", "Birmingham"], ["GB", "West Yorkshire"], ["GB", null],
  ["FI", null], ["SE", null], ["NO", null], ["DK", null], ["IS", null],
  ["SA", null], ["AE", null], ["QA", null], ["OM", null],
  ["DE", null], ["NL", null], ["FR", null], ["IE", null], ["ES", null],
];
const LINES = ["critical_power", "compute", "capital", "powered_land"];
const GATES = ["unverified", "unverified", "unverified", "qualified", "qualified", "protected", "verified"];
const WHAT = {
  critical_power: ["gas genset fleet", "aeroderivative turbines", "bridge power package", "peaker plant capacity"],
  compute: ["H200 cluster allocation", "B200 nodes, 2026 delivery", "GPU capacity, 512 cards", "GB200 rack lot"],
  capital: ["infrastructure fund deploying", "family office ticket", "development capital raise", "project finance need"],
  powered_land: ["powered shell with grid offer", "brownfield site, 132 kV", "campus land with water rights", "consented data-centre plot"],
};

export function synthetic(now = Date.now()) {
  const opportunities = [];
  for (let i = 0; i < 150; i++) {
    const [country, region] = pick(PLACES);
    const line = pick(LINES);
    const side = rnd() < 0.55 ? "supply" : "need";
    const mw = line === "capital" ? null : Math.round(5 + rnd() * rnd() * 400);
    const where = region ?? country;
    opportunities.push({
      id: uuid("0aaa0aaa", i + 1),
      line,
      side,
      title: `${where}: ${mw ? `${mw} MW ` : ""}${pick(WHAT[line])}`,
      country,
      region,
      credibility: Math.round(40 + rnd() * 55),
      gate: pick(GATES),
      created_at: new Date(now - rnd() * 30 * 864e5).toISOString(),
      organisation_id: null,
      mw,
      specs: { mw },
    });
  }
  const mandates = [
    { id: uuid("0ddd0ddd", 1), label: "M-01 US powered shells", line: "powered_land", side: "need", criteria: { countries: ["US"], mw_min: 50, target_side: "supply" } },
    { id: uuid("0ddd0ddd", 2), label: "M-02 GCC capacity", line: "critical_power", side: "need", criteria: { countries: ["AE", "SA", "QA", "OM"], target_side: "supply" } },
    { id: uuid("0ddd0ddd", 3), label: "M-03 Nordic sites", line: "powered_land", side: "need", criteria: { countries: ["FI", "SE", "NO", "DK", "IS"], target_side: "supply" } },
    { id: uuid("0ddd0ddd", 4), label: "CAPB-EU-01", line: "capital", side: "supply", criteria: { countries: ["DE", "NL", "FR", "GB"], target_side: "need" } },
    { id: uuid("0ddd0ddd", 5), label: "CMP-01 GPU buyer", line: "compute", side: "need", criteria: { keywords: ["H200"], target_side: "supply" } },
    { id: uuid("0ddd0ddd", 6), label: "PWR-UK-02", line: "critical_power", side: "need", criteria: { countries: ["GB"], target_side: "supply" } },
  ].map((m) => ({ ...m, capital_circle: false, active: true, created_at: "2026-10-01T09:00:00Z", matches: [{ count: 0 }], kind: "investor_mandate", holder: m.label, confidence: "partial", to_ask: null, card: {} }));

  const matches = [];
  let n = 0;
  for (const m of mandates) {
    const pool = opportunities.filter((o) => o.line === m.line && o.side === m.criteria.target_side);
    const k = 6 + Math.floor(rnd() * 10);
    for (let j = 0; j < k && pool.length; j++) {
      const o = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
      matches.push(matchRow(++n, m, o, null));
    }
  }
  const needs = opportunities.filter((o) => o.side === "need");
  const sups = opportunities.filter((o) => o.side === "supply");
  for (let j = 0; j < 18; j++) {
    const a = pick(needs);
    const b = pick(sups.filter((s) => s.line === a.line)) ?? pick(sups);
    matches.push(matchRow(++n, null, b, a));
  }
  matches.sort((a, b) => b.total_score - a.total_score);

  const stages = ["Lead", "Lead", "Lead", "Lead", "Qualified", "Qualified", "Qualified", "Protected", "Protected", "Verified", "Negotiating", "Closed – won"];
  const deals = stages.map((stage, i) => ({ id: uuid("0eee0eee", i + 1), deal: `Deal ${i + 1}`, stage, line: "Power", heat: "Warm", next_date: "2026-11-30" }));
  return { opportunities, mandates, matches, deals };

  function matchRow(i, mandate, supplyOrTarget, need) {
    const parts = { fit: 0, timing: 0, credibility: 0, reachability: 0, nodus_edge: 0, value: 0 };
    for (const p of Object.keys(parts)) parts[p] = Math.round(45 + rnd() * 50);
    let total = Math.round(Object.values(parts).reduce((a, b) => a + b, 0) / 6);
    const fb = rnd() < 0.15 ? { raw_total: total, adjustment: -6, notes: ["2 similar rejected as wrong geography (country US)"] } : null;
    if (fb) total -= 6;
    const o = supplyOrTarget;
    const isSupply = o.side === "supply";
    return {
      id: uuid("09990999", i),
      status: rnd() < 0.2 ? "shortlisted" : "proposed",
      total_score: total,
      scores: parts,
      thesis: mandate ? `${o.title} fits ${mandate.label}` : `${o.title} could serve ${need.title}`,
      explanation: {
        why: ["Same line and region", "Size within the mandate range", ...(fb ? ["Down-weighted 6 points: 2 similar rejected as wrong geography (country US)"] : [])],
        unknowns: ["Owner's appetite to sell or lease"],
        next_step: "Confirm the connection date with the owner.",
        evidence: [{ title: "Public register", url: "https://www.example.org/register" }],
        ...(fb ? { feedback: fb } : {}),
      },
      reject_reason: null,
      created_at: new Date(Date.now() - rnd() * 10 * 864e5).toISOString(),
      line: o.line,
      supply_id: mandate ? (isSupply ? o.id : null) : o.id,
      supply_title: mandate ? (isSupply ? o.title : null) : o.title,
      supply_gate: mandate ? (isSupply ? o.gate : null) : o.gate,
      need_id: mandate ? (isSupply ? null : o.id) : need.id,
      need_title: mandate ? (isSupply ? null : o.title) : need.title,
      need_gate: mandate ? (isSupply ? null : o.gate) : need.gate,
      mandate_id: mandate?.id ?? null,
      mandate_label: mandate?.label ?? null,
    };
  }
}

// ---------- Focus: priorities, their progress and a realistic review deck (all fictional people) ----------
const PEOPLE = [
  ["Maya Okafor", "Head of Infrastructure", "Halcyon AI Cloud"], ["Tomas Lindqvist", "VP Capacity", "Northwind Compute"],
  ["Priya Raman", "Director, Data Centres", "Atlas Neocloud"], ["Daniel Mercer", "Partner", "Greyfield Infrastructure"],
  ["Sofia Marchetti", "Investment Director", "Lumen Family Office"], ["James Whitaker", "Head of Development", "Midwest Digital Realty"],
  ["Hannah Cole", "CFO", "Quarry GPU"], ["Omar Haddad", "Managing Director", "Levant Capital Partners"],
  ["Erik Solberg", "Head of Site Acquisition", "Fjord Data Parks"], ["Rachel Kim", "VP Strategic Sourcing", "Vector AI Labs"],
  ["Luca Bernardi", "Principal", "Arcadia Credit"], ["Grace Liu", "Head of Compute", "Meridian Models"],
  ["Ben Ashworth", "Director", "Kestrel Asset Finance"], ["Nadia Farouk", "Head of Partnerships", "Sandline Cloud"],
  ["Chris Doyle", "Development Director", "Lakeshore Power Campus"], ["Ines Duarte", "Head of Infra Debt", "Porto Infra Credit"],
  ["Samir Patel", "COO", "Brightgrid Compute"],
];

export function focusData(now = Date.now()) {
  const pid = (n) => `abababab-0000-4000-8000-00000000000${n}`;
  const P = [
    [1, "Al-Risha phase 1: find the offtaker", "Signed LOI from an offtaker for phase 1 (50 MW)", "Neoclouds and AI labs needing 50 MW+ in the Middle East", "Reach 25 neoclouds with the anonymised Al-Risha teaser", "powered_land"],
    [2, "Mindstream ~$100m convertible note", "Term sheet from a lead investor", "Infrastructure funds and family offices writing $25m+ tickets", "Send the teaser to the 10 strongest investor mandates", "capital"],
    [3, "SE Wisconsin brownfield site (Project A)", "NCNDA signed with a developer or hyperscaler", "US developers looking for powered land in the Midwest", "Shortlist 15 Midwest developers and draft first touches", "powered_land"],
    [4, "New data-centre offtakers", "Three qualified offtaker conversations this month", "Hyperscalers, neoclouds and enterprise AI buyers", "Draft first touches to 20 offtakers", null],
    [5, "Optio: find borrowers", "Two borrowers in diligence", "GPU operators needing asset-backed finance", "Find 25 GPU operators raising debt", "compute"],
  ];
  const priorities = P.map(([rank, title, goal, who, next_action, line]) => ({
    id: pid(rank), rank, title, goal, who, next_action, line, mandate_ids: [], deal_ids: [], status: "active", notes: null,
    created_at: "2026-10-23T08:00:00Z", updated_at: "2026-10-23T08:00:00Z",
  }));
  priorities.push({ id: pid(9), rank: 9, title: "UK gas genset bridge power", goal: null, who: null, next_action: null, line: "critical_power", mandate_ids: [], deal_ids: [], status: "paused", notes: null, created_at: "2026-10-10T08:00:00Z", updated_at: "2026-10-20T08:00:00Z" });
  const tagOf = [1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5, 5, null, null, 1, 4];
  const contacts = [];
  const drafts = PEOPLE.map(([name, title, company], i) => {
    const id = `eeeeeeee-2222-4000-8000-${hex(i + 1, 12)}`;
    const cid = `cccccccc-2222-4000-8000-${hex(i + 1, 12)}`;
    const first = name.split(" ")[0];
    const li = i % 4 === 2;
    const tag = tagOf[i];
    const slug = name.toLowerCase().replace(/[^a-z]+/g, "-");
    contacts.push({ id: cid, name, title, company, email: `${first.toLowerCase()}@example.com`, linkedin: `https://www.linkedin.com/in/${slug}-example`, country: "GB", lines: [], side: null, category: null, stage: "New", priority: null, channel: li ? "linkedin" : "email", source: "router", signal: null, first_contact: null, last_activity: null, next_follow_up: null, do_not_contact: false, notes: null, updated_at: "2026-10-22T09:00:00Z" });
    const about = tag === 1
      ? ["Phase 1 capacity in Jordan", `Hello ${first},\n\nWe're working with a 50 MW campus in Jordan with phase 1 power secured and land in hand. Given ${company}'s growth in the region, would a short call next week be useful to see whether it fits your 2027 capacity plan?\n\nI can share an anonymised teaser first.\n\nBest,\nKuran`, `${company} is expanding GPU capacity in the Gulf; matched to priority 1 by the router.`]
      : tag === 2
        ? ["A convertible note in AI infrastructure", `Hello ${first},\n\nWe're introducing a convertible note backing a powered data-centre platform with secured land and power. It sits squarely in the ticket size and themes ${company} has backed before.\n\nWould you like the one-page summary?\n\nBest,\nKuran`, `Investor mandate: infrastructure, $25m+ tickets.`]
        : tag === 3
          ? ["Brownfield site in SE Wisconsin", `Hello ${first},\n\nWe have an off-market brownfield site in south-east Wisconsin with a utility conversation under way. If ${company} is still looking for Midwest land, I can share details under NCNDA.\n\nBest,\nKuran`, `${company} filed for two Midwest campuses this year.`]
          : tag === 5
            ? ["Asset-backed finance for your GPUs", `Hello ${first},\n\nWe work with a lender providing asset-backed finance against GPU fleets. If ${company} is weighing debt for the next build-out, a short call could save you time.\n\nBest,\nKuran`, `${company} announced a 1,024-card expansion.`]
            : ["Capacity for your next cluster", `Hello ${first},\n\nQuick one: we're seeing powered capacity come free in the Nordics and the Gulf for 2026–27. Is ${company} sourcing for anything in that window?\n\nBest,\nKuran`, null];
    return {
      id, kind: li ? "dm" : i % 5 === 4 ? "followup" : "email", channel: li ? "linkedin" : "email", contact_id: cid, to_name: name,
      to_email: li ? null : `${first.toLowerCase()}@example.com`, company, subject: li ? null : about[0],
      body: li ? `Hi ${first}, ${about[1].split("\n\n")[1].split(".")[0]}. Worth a quick chat?` : about[1],
      link: li ? `https://www.linkedin.com/in/${slug}-example` : null, sequence_step: 1, status: i === 15 ? "manual" : "draft", note: about[2],
      origin: "router", created_at: new Date(now - (20 - i) * 3600e3).toISOString(), approved_at: null, sent_at: null, replied_at: null,
      priority_id: tag ? pid(tag) : null,
    };
  });
  const replied = [
    ["Leila Nasser", "Desert Peak Cloud", "Re: Phase 1 capacity in Jordan", 1, 1],
    ["Mark Evans", "Ridgeway Capital", "Re: A convertible note in AI infrastructure", 2, 2],
    ["Aoife Byrne", "Shannon Compute", "Re: Capacity for your next cluster", null, 3],
  ].map(([to_name, company, subject, tag, d], i) => ({
    id: `eeeeeeee-3333-4000-8000-${hex(i + 1, 12)}`, kind: "email", channel: "email", contact_id: null, to_name, to_email: null, company, subject,
    body: "…", link: null, sequence_step: 1, status: "replied", note: null, origin: "router", created_at: new Date(now - 6 * 864e5).toISOString(),
    approved_at: null, sent_at: new Date(now - 5 * 864e5).toISOString(), replied_at: new Date(now - d * 864e5).toISOString(), priority_id: tag ? pid(tag) : null,
  }));
  const count = (n, st) => drafts.filter((o) => o.priority_id === pid(n) && o.status === st).length;
  const progress = [1, 2, 3, 4, 5, 9].map((n) => ({
    priority_id: pid(n),
    drafts: count(n, "draft"),
    approved: [3, 1, 0, 0, 0, 0][[1, 2, 3, 4, 5, 9].indexOf(n)],
    sent: [14, 9, 2, 0, 4, 6][[1, 2, 3, 4, 5, 9].indexOf(n)],
    replied: [2, 1, 0, 0, 0, 1][[1, 2, 3, 4, 5, 9].indexOf(n)],
    manual: count(n, "manual"),
    last_sent_at: null,
  }));
  return { priorities, progress, outreach: [...drafts, ...replied], contacts };
}
