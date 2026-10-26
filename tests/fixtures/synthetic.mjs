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
  const D = { ar: "dddddddd-5555-4000-8000-000000000001", ba: "dddddddd-5555-4000-8000-000000000002", wi: "dddddddd-5555-4000-8000-000000000003" };
  const P = [
    [1, "Al-Risha phase 1: find the offtaker", "Signed LOI from an offtaker for phase 1 (50 MW)", "Neoclouds and AI labs needing 50 MW+ in the Middle East", "Draft anonymised teasers to 25 offtakers; you approve", "powered_land", ["Compute-Buy"], [D.ar]],
    [2, "Al-Risha phase 1: ~$100m convertible investors", "Term sheet from a lead investor", "Infrastructure funds and family offices writing $25m+ tickets", "Send the capital soundings waiting in Review", "capital", ["Capital-Provide"], [D.ar]],
    [3, "Basalt 100 MW: equipment quotes and suppliers", "Three firm quotes against the BOM", "Server integrators and GPU distributors in Europe", "Await the client's answers to the 6 questions; then an anonymised RFQ to 5 integrators", "compute", ["Compute-Sell"], [D.ba]],
    [4, "SE Wisconsin brownfield site (Project A)", "NCNDA signed with a developer or hyperscaler", "US developers looking for powered land in the Midwest", "Match to US site buyers and development-equity investors; draft 15 approaches", "powered_land", ["Capital-Provide", "Land-Buy"], [D.wi]],
    [5, "Optio: find borrowers", "Two borrowers in diligence", "GPU operators needing asset-backed finance", "Find 25 GPU operators raising debt", "compute", ["Capital-Raise"], []],
  ];
  const priorities = P.map(([rank, title, goal, who, next_action, line, target_lines, deal_ids]) => ({
    id: pid(rank), rank, title, goal, who, next_action, line, mandate_ids: [], deal_ids, status: rank === 5 ? "paused" : "active", notes: null,
    target_lines, keywords: [], region_pattern: null,
    created_at: "2026-10-23T08:00:00Z", updated_at: "2026-10-23T08:00:00Z",
  }));
  priorities.push({ id: pid(9), rank: 9, title: "UK gas genset bridge power", goal: null, who: null, next_action: null, line: "critical_power", mandate_ids: [], deal_ids: [], status: "paused", notes: null, target_lines: [], keywords: [], region_pattern: null, created_at: "2026-10-10T08:00:00Z", updated_at: "2026-10-20T08:00:00Z" });
  const day = (n) => new Date(now + n * 864e5).toISOString().slice(0, 10);
  const deals = [
    { id: D.ar, deal: "Al-Risha phase 1: capital and offtake introductions", contact_id: null, counterparty: "Campus developer", line: "Capital", heat: "Hot", rank: 1, stage: "Qualified", principal_verified: "Yes", ncnda_signed: "Yes", fee_signed: "Yes", kyc_done: "No", proof_done: "No", next_date: day(4), next_step: "Investor notices to the developer for approval (first wave); capital soundings going out without names; chase the offtake information they promised.", value: null, terms: null, notes: null, updated_at: "2026-10-26T09:00:00Z" },
    { id: D.ba, deal: "Basalt joint offering: cooling, power and compute", contact_id: null, counterparty: "Integrator client", line: "Compute", heat: "Warm", rank: 2, stage: "Qualified", principal_verified: "No", ncnda_signed: "No", fee_signed: "No", kyc_done: "No", proof_done: "No", next_date: day(3), next_step: "Mutual NDA countersigned and six qualifying questions sent. Await answers; then the anonymised RFQ. Fee agreement before any supplier names.", value: null, terms: null, notes: null, updated_at: "2026-10-26T09:00:00Z" },
    { id: D.wi, deal: "Project A: introducer partnership and capital ask", contact_id: null, counterparty: "Introducer", line: "Powered land", heat: "Warm", rank: 3, stage: "Active", principal_verified: "No", ncnda_signed: "Yes", fee_signed: "N/A", kyc_done: "No", proof_done: "No", next_date: day(-6), next_step: "Answer the introducer: he asks for allocator and developer names. No fee protection yet, so no names.", value: null, terms: null, notes: null, updated_at: "2026-10-20T09:00:00Z" },
  ];
  const tagOf = [1, 1, 1, 1, 1, 2, 2, 2, 4, 4, 3, 5, 5, null, null, 1, 3];
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
        : tag === 4
          ? ["Brownfield site in SE Wisconsin", `Hello ${first},\n\nWe have an off-market brownfield site in south-east Wisconsin with a utility conversation under way. If ${company} is still looking for Midwest land, I can share details under NCNDA.\n\nBest,\nKuran`, `${company} filed for two Midwest campuses this year.`]
          : tag === 3
            ? ["Request for quote: GPU servers", `Hello ${first},\n\nWe're pricing a 100 MW build for a client and would value a quote from ${company} on GPU servers, networking and memory against a short bill of materials. Lead times matter as much as price.\n\nCould I send the anonymised BOM?\n\nBest,\nKuran`, `${company} integrates NVIDIA servers in Europe.`]
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
  // Old drafts parked for later: they must never reach the deck, counts or badges.
  const parked = [0, 1, 2].map((i) => ({
    id: `eeeeeeee-4444-4000-8000-${hex(i + 1, 12)}`, kind: "email", channel: "email", contact_id: null, to_name: ["Olivia Grant", "Felix Romero", "Aisha Bello"][i],
    to_email: null, company: ["Cobalt Ridge Capital", "Tern Data Systems", "Harbourline Infra"][i], subject: "An old first touch", body: "Hello, an older draft from September that was never sent.",
    link: null, sequence_step: 1, status: "parked", note: null, origin: "router", created_at: new Date(now - (30 + i) * 864e5).toISOString(),
    approved_at: null, sent_at: null, replied_at: null, priority_id: pid(1),
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
  return { priorities, progress, outreach: [...drafts, ...replied, ...parked], contacts, deals };
}

// ---------- the best people already in the CRM for a priority (priority_network), all fictional ----------
const NETWORK = {
  offtakers: [
    ["Leila Nasser", "Head of Capacity", "Desert Peak Cloud", "AE", "Replied", ["Line: Compute-Buy", "Mentions: neocloud, GPU", "Region fit", "Warm: Replied"], 98],
    ["Karim Aziz", "VP Infrastructure", "Sandline Cloud", "SA", "Meeting", ["Line: Compute-Buy", "Mentions: AI cloud", "Region fit", "Warm: Meeting"], 92],
    ["Maya Okafor", "Head of Infrastructure", "Halcyon AI Cloud", "GB", "Contacted", ["Line: Compute-Buy", "Mentions: inference, GPU", "Contacted in the last 14 days"], 81],
    ["Yusuf Demir", "Director, Compute", "Bosphorus AI", "TR", "New", ["Line: Compute-Buy", "Mentions: AI lab"], 66],
    ["Ana Ruiz", "Head of Data Centres", "Altamira Neocloud", "ES", "Nurture", ["Line: Compute-Buy", "Mentions: colocation"], 58],
    ["Peter Hall", "Capacity Planning Lead", "Kite Inference", "US", "New", ["Line: Compute-Buy", "Mentions: inference"], 54],
    ["Joon Park", "Head of Compute", "Seabright Labs", "KR", "New", ["Line: Compute-Buy"], 41],
  ],
  investors: [
    ["Omar Haddad", "Managing Director", "Levant Capital Partners", "AE", "Meeting", ["Line: Capital-Provide", "Mentions: infrastructure, data cent", "Region fit", "Warm: Meeting"], 104],
    ["Sofia Marchetti", "Investment Director", "Lumen Family Office", "CH", "Replied", ["Line: Capital-Provide", "Mentions: family office, AI", "Warm: Replied"], 90],
    ["Daniel Mercer", "Partner", "Greyfield Infrastructure", "GB", "Contacted", ["Line: Capital-Provide", "Mentions: digital infra", "Contacted in the last 14 days"], 77],
    ["Noura Al-Sabah", "Principal", "Gulfstream Family Office", "KW", "New", ["Line: Capital-Provide", "Mentions: family office", "Region fit"], 72],
    ["Henrik Moe", "Head of Real Assets", "Fjell Pension", "NO", "New", ["Line: Capital-Provide", "Mentions: infrastructure"], 55],
    ["Ravi Menon", "Director", "Saffron Sovereign Partners", "SG", "New", ["Line: Capital-Provide", "Mentions: sovereign"], 49],
  ],
  suppliers: [
    ["Jonas Weber", "Head of Sales, EMEA", "Rheinwerk Systems", "DE", "Replied", ["Line: Compute-Sell", "Mentions: server, NVIDIA", "Region fit", "Warm: Replied"], 104],
    ["Elise Vermeer", "Account Director", "Polder Compute Integration", "NL", "Meeting", ["Line: Compute-Sell", "Mentions: Supermicro, NVIDIA", "Region fit", "Warm: Meeting"], 96],
    ["Marc Keller", "Partner Manager", "Alpstack AG", "CH", "Qualified", ["Line: Compute-Sell", "Mentions: GPU, integrator", "Region fit", "Warm: Qualified"], 96],
    ["Tom Brennan", "Sales Director", "Northgate Servers", "GB", "Contacted", ["Line: Compute-Sell", "Mentions: server, GPU", "Region fit"], 83],
    ["Clara Hoffmann", "Head of Memory", "Kessel DRAM Trading", "DE", "New", ["Line: Compute-Sell", "Mentions: memory, DRAM", "Region fit"], 70],
    ["Pierre Laurent", "OEM Manager", "Lumiere Integration", "FR", "New", ["Line: Compute-Sell", "Mentions: OEM"], 61],
  ],
  land: [
    ["James Whitaker", "Head of Development", "Midwest Digital Realty", "US", "Replied", ["Line: Land-Buy", "Mentions: data cent, powered shell", "Region fit", "Warm: Replied"], 95],
    ["Chris Doyle", "Development Director", "Lakeshore Power Campus", "US", "Contacted", ["Line: Capital-Provide", "Mentions: brownfield, retrofit", "Region fit"], 84],
    ["Dana Price", "Managing Partner", "Prairie Digital Equity", "US", "New", ["Line: Capital-Provide", "Mentions: digital infra", "Region fit"], 71],
  ],
};

/** Rows for priority_network: which list depends on the priority's id (see focusData and fixtures.json). */
export function networkFor(priorityId, limit = 15) {
  const n = Number(String(priorityId).slice(-1));
  const key = n === 1 ? "offtakers" : n === 2 ? "investors" : n === 3 ? "suppliers" : n === 4 ? "land" : null;
  const rows = key ? NETWORK[key] : [];
  return rows.slice(0, limit).map(([name, title, company, country, stage, reasons, score], i) => ({
    contact_id: `cccccccc-7777-4000-8000-${hex(n * 100 + i + 1, 12)}`,
    name, title, company, country, stage,
    linkedin: i % 3 === 1 ? null : `https://www.linkedin.com/in/${name.toLowerCase().replace(/[^a-z]+/g, "-")}-example`,
    email: i % 2 ? null : `${name.split(" ")[0].toLowerCase()}@example.com`,
    score, reasons, last_touch: i === 1 ? "2026-10-06" : null,
  }));
}

// ---------- New leads (lead_candidates): fictional people Claude scouted outside the CRM ----------
const LEADS = {
  1: [
    ["Steve St***t", "VP Capacity Planning", "Northgate AI Cloud", "apollo", 92, "Buys 20-60 MW blocks for GPU clusters; expanding into the Gulf", "Northgate raised a $400m GPU facility in September", "https://example.com/northgate-facility"],
    ["Lena Hof***n", "Head of Data Centre Strategy", "Kestrel Neocloud", "apollo", 88, "Owns site selection for a neocloud adding MENA capacity", null, null],
    ["Arjun Me***a", "Director, Infrastructure", "Saffron Labs", "web", 84, "AI lab training in-region; public RFP for 40 MW in 2027", "Saffron Labs posted a 40 MW capacity RFP", "https://example.com/saffron-rfp"],
    ["Clara Jen***s", "SVP Compute", "Brightwave Models", "apollo", 81, "Leases GPU capacity; recent hires in Riyadh and Dubai", null, null],
    ["Faisal Q***i", "Chief Infrastructure Officer", "Dune Compute", "apollo", 79, "Regional GPU cloud looking for powered shells", null, null],
    ["Mei Tan***a", "Head of Capacity", "Lotus AI Cloud", "apollo", 76, "Asia neocloud with stated Middle East expansion", null, null],
    ["Owen Bra***y", "VP Infrastructure", "Halberd Compute", "apollo", 74, "Buys colocation for H200 clusters", null, null],
    ["Rosa Del***o", "Director of Sourcing", "Vireo AI", "web", 72, "Sourcing 30 MW for inference in 2027", null, null],
  ],
  2: [
    ["Hugo Ve***t", "Partner, Infrastructure", "Meridian Gulf Capital", "8raise", 90, "Writes $25-75m tickets into digital infrastructure in the GCC", "Meridian Gulf closed a $1.2bn infra fund", "https://example.com/meridian-close"],
    ["Selma Ar***n", "Investment Director", "Cedar Family Office", "8raise", 83, "Family office with data-centre convertibles in its book", null, null],
    ["Paolo Fe***i", "Managing Director", "Arcturus Infra Credit", "apollo", 77, "Structured credit for powered land and campuses", null, null],
  ],
  3: [
    ["Jonas Wi***r", "Head of Sales EMEA", "Fjell Systems", "apollo", 86, "Server integrator with H200 allocation in Q1", null, null],
    ["Ana Ro***s", "Director, Channel", "Brightline Distribution", "apollo", 80, "GPU distributor serving European neoclouds", null, null],
  ],
};

export function leadCandidates() {
  const rows = [];
  for (const [n, list] of Object.entries(LEADS)) {
    list.forEach(([name, title, company, source, fit_score, fit_reason, hook, hook_url], i) => {
      rows.push({
        id: `1eadcafe-0000-4000-8000-${hex(Number(n) * 100 + i + 1, 12)}`,
        priority_id: `abababab-0000-4000-8000-00000000000${n}`,
        name, title, company, company_domain: null,
        linkedin: i % 2 ? null : `https://www.linkedin.com/in/${name.toLowerCase().replace(/[^a-z]+/g, "-")}example`,
        country: null, source, source_ref: source === "apollo" ? `ap${hex(Number(n) * 100 + i + 1, 8)}` : null,
        hook, hook_url, fit_score, fit_reason, status: "new", contact_id: null, decided_at: null,
        created_at: "2026-10-26T06:00:00Z",
      });
    });
  }
  return rows;
}

// ---------- front page: today's brief, the bd_queue view and Background BD leads (all fictional) ----------

/** A daily_briefs row for `day` (UK date). Every name and number is made up. */
export function dailyBrief(day) {
  return {
    day,
    created_at: `${day}T05:40:00Z`,
    body: {
      headline: "Al-Risha offtaker LOI is the week’s swing. Two neocloud calls today decide it.",
      calls: [
        { time: "10:30", who: "Harlow Compute (CEO)", goal: "Qualify 40 MW need for phase 1; ask for LOI timing" },
        { time: "14:00", who: "Brightwater Capital", goal: "Investor intro call; confirm ticket range and NCNDA" },
      ],
      do_now: [
        { text: "Send the Al-Risha teaser to the three warmest neoclouds", link: "#/review" },
        { text: "Chase the Basalt fee letter before Thursday" },
        { text: "Confirm the 14:00 agenda with Brightwater", link: "https://example.com/brightwater-agenda" },
      ],
      could_do: [
        { text: "Comment on two GTC Berlin posts from capital allocators" },
        "Tidy the Optio borrower list",
      ],
      mandates: [{ rank: 1, title: "Al-Risha phase 1", status: "signed", next: "Offtaker LOI", overdue: false }],
      digest: [
        "Engine: 41 new opportunities overnight, 6 in focus lines.",
        "Nordics: two new data-centre companies registered in Finland.",
        "GCC: sovereign fund signals more AI infrastructure allocation.",
        "US: a 200 MW powered shell in Texas listed for sale.",
        "This fifth line should never show.",
      ],
      rep: { q: "What does a take-or-pay clause protect in a capacity LOI?", a: "The seller’s revenue: the buyer pays for reserved capacity whether or not it uses it." },
    },
  };
}

/** bd_queue: 32 rows routed to a mandate (tier A) and 820 in the background (tier B). Only tier is read for counts. */
export function bdQueue() {
  const rows = [];
  for (let i = 0; i < 852; i++) rows.push({ opportunity_id: `0bb0bb00-0000-4000-8000-${hex(i + 1, 12)}`, tier: i < 32 ? "A" : "B", bd_score: 90 - (i % 50) });
  return rows;
}

const BD = [
  ["Rhea S***n", "Managing Partner", "Kestrel Ridge Infrastructure", "capital", 86, "Fund closing for AI infrastructure; writes 30-80m tickets", "Kestrel Ridge closes second infrastructure fund"],
  ["Tomas Lin***d", "Head of Development", "Northfjord Datahall AS", "powered_land", 81, "New Norwegian data-centre company seeking grid-connected land", "Northfjord Datahall registered in Bergen"],
  ["Priya Ve***a", "VP Capacity", "Lumen Atlas Cloud", "compute", 77, "Neocloud buying GPU allocation for Q2 2027", "Lumen Atlas announces 4,000-GPU expansion"],
  ["Jonas Ek***m", "CFO", "Stellar Heat Oy", "capital", 72, "Raising development capital for a 60 MW Finnish campus", "Stellar Heat seeks development partner"],
  ["Amira H***d", "Director, Real Estate", "Gulfline Digital", "powered_land", 68, "Looking for powered land near Dammam", "Gulfline Digital tender for 100 MW site"],
];

/** Fictional engine opportunities behind the Background BD leads (only returned when looked up by id). */
export function bdOpps() {
  return BD.map((b, i) => ({ id: `0bb0bb00-0000-4000-8000-${hex(i + 1, 12)}`, line: b[3] }));
}

/** Background BD leads: lead_candidates with no priority, from the engine. */
export function bdLeads() {
  return BD.map(([name, title, company, , fit_score, fit_reason, hook], i) => ({
    id: `bdbdbdbd-0000-4000-8000-${hex(i + 1, 12)}`,
    priority_id: null,
    opportunity_id: `0bb0bb00-0000-4000-8000-${hex(i + 1, 12)}`,
    match_id: null,
    name, title, company, company_domain: null, linkedin: null, country: null,
    source: "engine", source_ref: `ap${hex(900 + i, 8)}`,
    hook, hook_url: `https://example.com/evidence-${i + 1}`,
    fit_score, fit_reason, status: "new", contact_id: null, decided_at: null,
    created_at: "2026-10-25T19:00:00Z",
  }));
}
