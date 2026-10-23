import { test } from "node:test";
import assert from "node:assert/strict";
import { COUNTRIES, locate, mandateCountries, mwOf, placeAll, regionGroup, spreadPoint, usState } from "../src/lib/geo.ts";
import { buildGraph, clip, curve, linkStyle } from "../src/lib/graph.ts";
import type { MatchCardRow } from "../src/lib/types.ts";

test("US states are read from the region suffix or full name", () => {
  assert.equal(usState("Clark, NV"), "NV");
  assert.equal(usState("NY"), "NY");
  assert.equal(usState("Onondaga, New York"), "NY");
  assert.equal(usState("St. Lawrence, NY"), "NY");
  assert.equal(usState("A1"), null);
  assert.equal(usState(null), null);
});

test("placement precision: US state, then UK place, then country", () => {
  assert.equal(locate("US", "Clark, NV")?.precision, "state");
  assert.equal(locate("US", "Clark, NV")?.key, "US-NV");
  assert.equal(locate("US", null)?.precision, "country");
  assert.equal(locate("GB", "North Yorkshire")?.precision, "place");
  assert.equal(locate("GB", "Somewhere Unknown")?.precision, "country");
  assert.equal(locate("FI", null)?.precision, "country");
  assert.equal(locate(null, null), null);
  assert.equal(locate("ZZ", "x"), null);
});

test("region groups follow the five Nodus regions", () => {
  assert.equal(regionGroup("GB"), "UK");
  assert.equal(regionGroup("US"), "USA");
  assert.equal(regionGroup("NO"), "Nordics");
  assert.equal(regionGroup("SA"), "GCC");
  assert.equal(regionGroup("DE"), "Europe");
  assert.equal(regionGroup("SG"), "Other");
  assert.equal(regionGroup(null), "Other");
});

test("crowds are spread, a lone point stays put, and the spread is stable", () => {
  const p = locate("US", "Clark, NV")!;
  assert.deepEqual(spreadPoint(p, 0, 1), [p.lon, p.lat]);
  const items = Array.from({ length: 20 }, (_, i) => ({ id: `id-${String(i).padStart(2, "0")}`, country: "US", region: "Clark, NV" }));
  const a = placeAll(items);
  const b = placeAll([...items].reverse());
  assert.equal(a.length, 20);
  const coords = new Set(a.map((x) => `${x.lon.toFixed(5)},${x.lat.toFixed(5)}`));
  assert.equal(coords.size, 20, "no two points on the same spot");
  for (const x of a) assert.ok(Math.abs(x.lat - p.lat) <= p.spread + 1e-9);
  const pos = (arr: typeof a) => Object.fromEntries(arr.map((x) => [x.item.id, [x.lon, x.lat]]));
  assert.deepEqual(pos(a), pos(b));
  assert.equal(placeAll([{ id: "x", country: null, region: null }]).length, 0);
});

test("every country has an ISO numeric code for the outlines", () => {
  for (const c of Object.values(COUNTRIES)) assert.match(c.num, /^\d{3}$/, c.iso2);
  assert.equal(COUNTRIES.GB.num, "826");
  assert.equal(COUNTRIES.US.num, "840");
});

test("MW and mandate countries are read safely", () => {
  assert.equal(mwOf(50), 50);
  assert.equal(mwOf("120 MW"), 120);
  assert.equal(mwOf(null), null);
  assert.equal(mwOf("n/a"), null);
  assert.deepEqual(mandateCountries({ countries: ["gb", "US", "GB", 3, "Nordics"] }), ["GB", "US"]);
  assert.deepEqual(mandateCountries(null), []);
});

function m(id: string, score: number, o: Partial<MatchCardRow>): MatchCardRow {
  return {
    id, status: "proposed", total_score: score, scores: {}, thesis: id, explanation: null, reject_reason: null, created_at: "2026-10-20T00:00:00Z",
    line: "compute", supply_id: null, supply_title: null, supply_gate: null, need_id: null, need_title: null, need_gate: null, mandate_id: null, mandate_label: null, ...o,
  };
}

test("engine graph: mandates and needs on the left, opportunities on the right", () => {
  const g = buildGraph([
    m("a", 80, { mandate_id: "M1", mandate_label: "M-01", supply_id: "S1", supply_title: "Site 1" }),
    m("b", 70, { mandate_id: "M1", mandate_label: "M-01", supply_id: "S2", supply_title: "Site 2" }),
    m("c", 60, { need_id: "N1", need_title: "Need 1", supply_id: "S2", supply_title: "Site 2" }),
    m("d", 50, { mandate_id: "M2", mandate_label: "M-02", need_id: "N2", need_title: "Need 2" }),
    m("e", 90, {}), // nothing to connect: left out
  ]);
  assert.deepEqual(g.left.map((n) => n.key), ["m:M1", "o:N1", "m:M2"]);
  assert.equal(g.right.length, 3);
  assert.equal(g.links.length, 4);
  assert.equal(g.links.at(-1)?.score, 80, "strongest drawn last");
  assert.equal(g.right.find((n) => n.key === "o:S2")?.degree, 2);
  for (const n of [...g.left, ...g.right]) assert.ok(n.y > 0 && n.y < 1);
  // right side follows the left: Site 1 (only M1) sits above Need 2 (only M2)
  const y = (k: string) => g.right.find((n) => n.key === k)!.y;
  assert.ok(y("o:S1") < y("o:N2"));
});

test("link style grows with score; labels clip on a word", () => {
  assert.ok(linkStyle(80).width > linkStyle(50).width);
  assert.ok(linkStyle(100).opacity <= 0.8);
  assert.equal(clip("Short", 10), "Short");
  assert.equal(clip("Lancaster NE 120 MW bridge power", 16), "Lancaster NE…");
  assert.match(curve(0, 0, 100, 50), /^M0\.0,0\.0 C50\.0,0\.0 50\.0,50\.0 100\.0,50\.0$/);
});
