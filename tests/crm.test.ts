import { test } from "node:test";
import assert from "node:assert/strict";
import { appendNote, checkHqExport, compareActions, compareDeals, fmtDay, gateScore, isDue, isOverdue, stageBlocker, ukToday } from "../src/lib/crm.ts";

test("gate score counts the Yes answers out of five", () => {
  assert.equal(gateScore({}), 0);
  assert.equal(gateScore({ principal_verified: "Yes", ncnda_signed: "yes", fee_signed: "No", kyc_done: "N/A", proof_done: null }), 2);
  assert.equal(gateScore({ principal_verified: "Yes", ncnda_signed: "Yes", fee_signed: "Yes", kyc_done: "Yes", proof_done: " Yes " }), 5);
});

test("Protected needs NCNDA and fee signed; Verified also needs principal, KYC and proof", () => {
  assert.equal(stageBlocker("Lead", {}), null);
  assert.equal(stageBlocker("Qualified", {}), null);
  assert.equal(stageBlocker("Protected", { ncnda_signed: "Yes", fee_signed: "No" }), "Protected needs Fee agreement signed to be Yes first.");
  assert.equal(stageBlocker("Protected", { ncnda_signed: "Yes", fee_signed: "Yes" }), null);
  const partly = { ncnda_signed: "Yes", fee_signed: "Yes", principal_verified: "Yes", kyc_done: "N/A" };
  assert.equal(stageBlocker("Verified", partly), "Verified needs KYC done and Proof done to be Yes first.");
  assert.match(stageBlocker("Verified", {}) ?? "", /NCNDA signed, Fee agreement signed, Principal verified, KYC done and Proof done/);
  assert.equal(stageBlocker("Verified", { ...partly, kyc_done: "Yes", proof_done: "Yes" }), null);
  assert.notEqual(stageBlocker("Introduced", { ncnda_signed: "Yes", fee_signed: "Yes" }), null);
});

test("dated notes are appended on a new line, never overwritten", () => {
  assert.equal(appendNote(null, "Called him", "2026-10-22"), "2026-10-22: Called him");
  assert.equal(appendNote("", "  first  ", "2026-10-22"), "2026-10-22: first");
  assert.equal(appendNote("2026-10-01: Met at DCD\n", "Sent NCNDA", "2026-10-22"), "2026-10-01: Met at DCD\n2026-10-22: Sent NCNDA");
  assert.equal(appendNote("old", "two\nlines", "2026-10-22"), "old\n2026-10-22: two lines");
  assert.equal(appendNote("keep me", "   ", "2026-10-22"), null);
  assert.match(appendNote(null, "x") ?? "", /^\d{4}-\d{2}-\d{2}: x$/);
});

test("UK days, due and overdue", () => {
  assert.equal(ukToday(new Date("2026-06-30T23:30:00Z")), "2026-07-01");
  assert.equal(ukToday(new Date("2026-12-31T23:30:00Z")), "2026-12-31");
  assert.equal(fmtDay("2026-10-05"), "5 Oct 2026");
  assert.equal(fmtDay(null), "—");
  assert.equal(isOverdue("2026-10-21", "2026-10-22"), true);
  assert.equal(isOverdue("2026-10-22", "2026-10-22"), false);
  assert.equal(isDue("2026-10-22", "2026-10-22"), true);
  assert.equal(isDue(null, "2026-10-22"), false);
});

test("deals sort hot to cold then by rank; actions by focus, priority, due", () => {
  const deals = [
    { heat: "Cold", rank: 1 }, { heat: "Hot", rank: null }, { heat: "Hot", rank: 2 }, { heat: "Warm", rank: 1 }, { heat: null, rank: 1 },
  ].sort(compareDeals);
  assert.deepEqual(deals.map((d) => `${d.heat}${d.rank}`), ["Hot2", "Hotnull", "Warm1", "Cold1", "null1"]);
  const acts = [
    { focus_rank: null, priority: "urgent", due: null },
    { focus_rank: 2, priority: "normal", due: null },
    { focus_rank: 1, priority: "normal", due: null },
    { focus_rank: null, priority: "high", due: "2026-10-20" },
    { focus_rank: null, priority: "high", due: "2026-10-19" },
  ].sort(compareActions);
  assert.deepEqual(acts.map((a) => `${a.focus_rank}-${a.priority}-${a.due}`), [
    "1-normal-null", "2-normal-null", "null-urgent-null", "null-high-2026-10-19", "null-high-2026-10-20",
  ]);
});

test("the HQ export is checked before import", () => {
  assert.equal(checkHqExport(null).ok, false);
  assert.equal(checkHqExport([]).ok, false);
  assert.equal(checkHqExport({ export: "other" }).ok, false);
  const r = checkHqExport({ export: "nodus-hq", date: "2026-10-22", contacts: [{}, {}], deals: [{}], actions: "x" });
  assert.deepEqual(r, { ok: true, date: "2026-10-22", counts: { contacts: 2, deals: 1, actions: 0, outreach: 0, mandates: 0 } });
});
