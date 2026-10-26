// Fake sequencer data for the smoke test: live stages (opportunity_stage), the bd_queue ranking and an empty
// opportunity_pipeline. Deterministic and fictional; shaped like the real views.

const CYCLE = ["found", "found", "found", "researched", "found", "people", "drafted", "found", "contacted", "conversation", "found", "dismissed", "protected"];

export const RESEARCHED_ID = "11111111-1111-4111-8111-111111111111";

const RESEARCH = {
  summary: "A 40 MW gas-fired site in West London whose owner is looking for a data-centre tenant before the 2027 grid date.",
  what_they_need: "A creditworthy tenant or offtaker, then development capital",
  value_exchange: "We bring tenants and capital introductions; we want to understand their timeline and grid position",
  angle: "Their planning committee date is next month, so they are talking to tenants now",
  risks: ["Grid date could slip", "Owner may already have an agent"],
  sources: ["https://example.org/ealing-planning", "https://example.org/grid-register"],
};

export function sequencerData(opportunities, priorities) {
  const stage = opportunities.map((o, i) => {
    const s = o.id === RESEARCHED_ID ? "researched" : CYCLE[i % CYCLE.length];
    return {
      opportunity_id: o.id,
      stage: s,
      research: o.id === RESEARCHED_ID ? RESEARCH : s === "found" ? null : { summary: `${o.title}: checked against the sources.` },
      next_action: o.id === RESEARCHED_ID ? "Find the head of development and the CFO" : null,
      dismissed_reason: s === "dismissed" ? "Noise" : null,
      updated_at: "2026-10-26T08:00:00Z",
    };
  });
  const byId = new Map(stage.map((r) => [r.opportunity_id, r.stage]));
  const active = priorities.filter((p) => p.status === "active");
  const unworked = opportunities.filter((o) => byId.get(o.id) === "found" || o.id === RESEARCHED_ID).slice(0, 22);
  const bd = unworked.map((o, i) => ({
    opportunity_id: o.id,
    line: o.line,
    side: o.side,
    title: o.title,
    country: o.country,
    region: o.region ?? null,
    mw: o.specs?.mw ?? null,
    credibility: o.credibility,
    created_at: o.created_at,
    organisation_id: null,
    legal_name: i % 3 === 2 ? null : `Fictional ${["Grid", "Compute", "Capital", "Land"][i % 4]} Holdings ${i + 1} Ltd`,
    website_domain: null,
    best_score: 80 - i,
    suggested_priority_id: i < 8 ? active[i % active.length]?.id ?? null : null,
    evidence_url: `https://example.org/evidence/${i + 1}`,
    tier: i < 8 ? "A" : "B",
    bd_score: Math.round((78 - i * 1.7) * 10) / 10,
  }));
  return { opportunity_stage: stage, bd_queue: bd, opportunity_pipeline: [] };
}
