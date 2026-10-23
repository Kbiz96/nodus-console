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
