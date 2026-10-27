import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classTags, defaultIcp, headcountRanges, hitsExclusion, icpTitles, nextLabel, parseOpportunity, regionLocations, scoreResult, sizeEvidence,
} from "../supabase/functions/nodus-apollo/rails.ts";

test("region_pref codes become Apollo locations", () => {
  assert.deepEqual(regionLocations(["SA", "AE"]), ["Saudi Arabia", "United Arab Emirates"]);
  assert.deepEqual(regionLocations(["Nordics"]), ["Norway", "Sweden", "Finland", "Denmark", "Iceland"]);
  assert.deepEqual(regionLocations(["EU", "DE"]), ["Europe", "Germany"]);
  assert.deepEqual(regionLocations(undefined), []);
});

test("ICP titles split on slashes and drop brackets", () => {
  assert.deepEqual(icpTitles(["Head of Infrastructure / Digital Infrastructure", "CIO (family office)"]), ["Head of Infrastructure", "Head of Digital Infrastructure", "CIO"]);
});

test("class maps to organisation keyword tags; capital falls back to investor tags", () => {
  assert.ok(classTags(["sovereign", "infra_fund"], "capital").includes("sovereign wealth fund"));
  assert.ok(classTags(undefined, "capital").includes("family office"));
  assert.deepEqual(classTags(undefined, "compute"), []);
});

test("size rails become headcount proxies only for capital", () => {
  const big = headcountRanges({ fund_min_usd: 3e9, min_ticket_usd: 100e6 }, "capital");
  assert.equal(big[0], "51,100");
  const mid = headcountRanges({ fund_min_usd: 50e6, fund_max_usd: 1e9 }, "capital");
  assert.equal(mid[0], "1,10");
  assert.equal(mid.at(-1), "201,500");
  assert.deepEqual(headcountRanges({ offtake_mw_min: 10 }, "compute"), []);
});

test("size evidence says unverified when Apollo has nothing", () => {
  const none = sizeEvidence(undefined, { fund_min_usd: 1e9 }, "capital");
  assert.match(none.text, /unverified: no size data in Apollo/);
  assert.match(none.text, /fund size vs \$1bn\+ unverified/);
  assert.equal(none.meets, null);
  const some = sizeEvidence({ estimated_num_employees: 300 }, { fund_min_usd: 1e9 }, "capital");
  assert.equal(some.meets, true);
});

test("exclude and disqualify rules drop lenders, banks and mega funds", () => {
  assert.equal(hitsExclusion(["pure_lender"], "acme private credit partners", 50), "pure_lender");
  assert.equal(hitsExclusion(["lenders only"], "infrastructure fund", 50), null);
  assert.equal(hitsExclusion(["bank"], "gulf investment bank", 50), "bank");
  assert.equal(hitsExclusion(["mega funds"], "x", 5000), "mega funds");
});

test("a result is scored against title, region, type and size rails", () => {
  const s = scoreResult({ title: "Head of Infrastructure", country: "Saudi Arabia" }, { name: "Example Capital", industry: "investment management", keywords: ["infrastructure fund"], estimated_num_employees: 250 }, {
    line: "capital", criteria: { fund_min_usd: 3e9 }, titles: ["Head of Infrastructure"], locations: ["Saudi Arabia"], tags: ["infrastructure fund"], rules: ["pure_lender"],
  });
  assert.deepEqual(s.rails, ["title: Head of Infrastructure", "region: Saudi Arabia", "type: infrastructure fund", "size: headcount proxy met"]);
  assert.equal(s.fit_score, 100);
  assert.equal(s.excluded, null);
});

test("New opportunity: kind, line, sizes and regions by simple rules", () => {
  const a = parseOpportunity("Jordan AI campus raising $100-300m equity, Gulf investors preferred");
  assert.equal(a.kind, "capital_ask");
  assert.equal(a.line, "capital");
  assert.equal(a.criteria.min_ticket_usd, 100e6);
  assert.equal(a.criteria.max_ticket_usd, 300e6);
  assert.ok(a.criteria.region_pref?.includes("JO") && a.criteria.region_pref?.includes("SA"));

  const s = parseOpportunity("We hold a 40 MW powered site in Norway with grid connection");
  assert.equal(s.kind, "site");
  assert.equal(s.line, "powered_land");
  assert.equal(s.criteria.mw_min, 40);
  assert.deepEqual(s.criteria.region_pref, ["NO"]);

  const n = parseOpportunity("Neocloud needs 10-70 MW of GPU capacity in Germany");
  assert.equal(n.kind, "need");
  assert.equal(n.line, "compute");
  assert.equal(n.criteria.offtake_mw_min, 10);
  assert.equal(n.criteria.offtake_mw_max, 70);

  const i = parseOpportunity("Family office with $2bn AUM looking to invest $20m tickets in UK data centres");
  assert.equal(i.kind, "investor_mandate");
  assert.equal(i.criteria.fund_min_usd, 2e9);
  assert.equal(i.criteria.min_ticket_usd, 20e6);
  assert.equal(i.criteria._source, "console");
});

test("new mandate codes follow the existing series and never carry names", () => {
  assert.equal(nextLabel(["C36 capital ask (capital)", "C08 need (compute)", "S01 site (powered land)"], "capital_ask", "capital"), "C37 capital ask (capital)");
  assert.equal(nextLabel(["S01 site (powered land)"], "site", "powered_land"), "S02 site (powered land)");
  assert.equal(defaultIcp("site", "powered_land").titles?.[0], "CTO");
  assert.equal(defaultIcp("capital_ask", "capital").approach, "relationship first; mandate range; blind summary");
});
