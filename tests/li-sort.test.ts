import { test } from "node:test";
import assert from "node:assert/strict";
import { fitOf, isSortKey, laneTag, postDate, reachOf, shortDay, sortLinkedIn, sortOptions } from "../src/lib/liSort.ts";

const row = (to_name: string, created_at: string, note: string, company: string | null = null) => ({ to_name, created_at, note, company });

const dms = [
  row("Old Capital", "2026-11-02T10:00:00Z", "LI: CAPITAL · 1st · fit B · WHY: x", "Zeta Fund"),
  row("New Operator", "2026-11-16T15:00:00Z", "LI: OPERATORS · 1st · fit B · WHY: y", "Alpha DC"),
  row("Mid Compute", "2026-11-09T09:00:00Z", "LI: COMPUTE · 1st · fit A · WHY: z", null),
];

test("newest first by default order, oldest reverses it", () => {
  assert.deepEqual(sortLinkedIn(dms, "newest").map((r) => r.to_name), ["New Operator", "Mid Compute", "Old Capital"]);
  assert.deepEqual(sortLinkedIn(dms, "oldest").map((r) => r.to_name), ["Old Capital", "Mid Compute", "New Operator"]);
  assert.equal(dms[0].to_name, "Old Capital", "sorting returns a copy");
});

test("fit A first, ties newest first; lane, name and company A–Z with blanks last", () => {
  assert.deepEqual(sortLinkedIn(dms, "fit").map((r) => r.to_name), ["Mid Compute", "New Operator", "Old Capital"]);
  assert.deepEqual(sortLinkedIn(dms, "lane").map((r) => r.to_name), ["Old Capital", "Mid Compute", "New Operator"]);
  assert.deepEqual(sortLinkedIn(dms, "name").map((r) => r.to_name), ["Mid Compute", "New Operator", "Old Capital"]);
  assert.deepEqual(sortLinkedIn(dms, "company").map((r) => r.to_name), ["New Operator", "Old Capital", "Mid Compute"]);
});

test("comments sort by when the post went up (absolute or 'posted 3h ago')", () => {
  const c = [
    row("Week old", "2026-11-16T12:00:00Z", "LI: COMMENT · post · WHY: A post, 10 Nov 2026 · Find the post starting: \"x\""),
    row("Fresh", "2026-11-15T12:00:00Z", "LI: COMMENT · posted 2h ago · WHY: b"),
    row("Today", "2026-11-14T12:00:00Z", "LI: COMMENT · post · WHY: C post, 16 Nov 2026"),
  ];
  assert.deepEqual(sortLinkedIn(c, "post").map((r) => r.to_name), ["Today", "Fresh", "Week old"]);
  assert.equal(postDate(c[1])?.toISOString(), "2026-11-15T10:00:00.000Z");
  assert.equal(postDate({ note: "nothing", created_at: "2026-11-15T12:00:00Z" }), null);
});

test("note parsing and options", () => {
  assert.equal(fitOf("LI: CAPITAL · 1st · fit A · WHY"), "A");
  assert.equal(fitOf("no grade"), null);
  assert.equal(laneTag("LI: OFFTAKER · 2nd"), "OFFTAKERS");
  assert.equal(laneTag("LI: COMMENT · post"), null);
  assert.ok(sortOptions("comment").some((o) => o.k === "post"));
  assert.ok(!sortOptions("comment").some((o) => o.k === "fit"));
  assert.ok(isSortKey("fit", "dm") && !isSortKey("fit", "comment") && !isSortKey("bogus", "dm"));
  assert.equal(shortDay("2026-11-16T15:00:00Z", new Date("2026-11-20T00:00:00Z")), "16 Nov");
  assert.equal(shortDay("2025-11-16T15:00:00Z", new Date("2026-11-20T00:00:00Z")), "16 Nov 2025");
  assert.equal(shortDay("garbage"), null);
});

test("v3 notes: lane after a prefix, GPU lanes are compute, speed score as fit, reach sort", () => {
  assert.equal(laneTag("REWRITTEN 18 Nov 2026 vs live requirements · LI v3: GPU-SUPPLY · x"), "COMPUTE");
  assert.equal(laneTag("LI v3: CAPITAL · 1st · WHY: y"), "CAPITAL");
  assert.equal(laneTag("LI: GPU-FINANCE · not connected"), "COMPUTE");
  assert.equal(fitOf("LI: GPU-DEMAND · 1st · S8 · WHY"), "A");
  assert.equal(fitOf("LI: GPU-DEMAND · 2nd · S5 · WHY"), "B");
  assert.equal(reachOf("LI: COMMENT · posted 1h ago · reach 290k · WHY"), 290000);
  assert.equal(reachOf("reach 12,400 followers"), 12400);
  assert.equal(reachOf("reach 1.2m"), 1200000);
  assert.equal(reachOf("nothing"), null);
  const c = [
    row("Small", "2026-11-19T08:00:00Z", "LI: COMMENT · posted 1h ago · reach 3k · WHY"),
    row("Big", "2026-11-19T07:00:00Z", "LI: COMMENT · posted 2h ago · reach 290k · WHY"),
    row("Unknown", "2026-11-19T09:00:00Z", "LI: COMMENT · posted 1h ago · WHY"),
  ];
  assert.deepEqual(sortLinkedIn(c, "reach").map((r) => r.to_name), ["Big", "Small", "Unknown"]);
  assert.ok(sortOptions("comment").some((o) => o.k === "reach"));
});
