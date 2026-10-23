import { test } from "node:test";
import assert from "node:assert/strict";
import { countOf, delta, scoreRows, SCORE_METRICS, trackedLate, ukWeekStart, weekPeriods } from "../src/lib/scoreboard.ts";
import { feedbackLine, REJECT_REASONS, rejectProblem } from "../src/lib/feedback.ts";

test("weeks run Monday to Sunday in UK time", () => {
  assert.equal(ukWeekStart(new Date("2026-10-23T12:00:00Z")), "2026-10-19"); // Friday
  assert.equal(ukWeekStart(new Date("2026-10-19T00:30:00Z")), "2026-10-19"); // Monday 01:30 BST
  assert.equal(ukWeekStart(new Date("2026-10-18T22:30:00Z")), "2026-10-12"); // Sunday 23:30 BST: still last week
  assert.equal(ukWeekStart(new Date("2026-10-18T23:30:00Z")), "2026-10-19"); // 00:30 BST Monday: new week
  assert.equal(ukWeekStart(new Date("2027-01-03T23:59:00Z")), "2026-12-28"); // across the new year, GMT
});

test("periods are exact UTC instants, across the clocks going back", () => {
  const { thisWeek, lastWeek } = weekPeriods(new Date("2026-10-27T09:00:00Z"));
  // Monday 26 Oct 00:00 GMT; the week before started Monday 19 Oct 00:00 BST (23:00 UTC on the Sunday).
  assert.equal(thisWeek.from, "2026-10-26T00:00:00.000Z");
  assert.equal(thisWeek.to, "2026-11-02T00:00:00.000Z");
  assert.equal(lastWeek.from, "2026-10-18T23:00:00.000Z");
  assert.equal(lastWeek.to, thisWeek.from);
  assert.equal(thisWeek.firstDay, "2026-10-26");
  assert.equal(thisWeek.lastDay, "2026-11-01");
  assert.equal(lastWeek.lastDay, "2026-10-25");
});

test("counts and changes against last week", () => {
  assert.equal(countOf({ replies: 3 }, "replies"), 3);
  assert.equal(countOf({}, "replies"), 0);
  assert.equal(countOf(null, "meetings"), 0);
  assert.equal(countOf({ meetings: "4" as unknown as number }, "meetings"), 4);
  assert.equal(countOf({ meetings: -1 }, "meetings"), 0);
  assert.deepEqual(delta(5, 2), { text: "+3", dir: "up" });
  assert.deepEqual(delta(1, 3), { text: "−2", dir: "down" });
  assert.deepEqual(delta(0, 0), { text: "=", dir: "same" });
  const rows = scoreRows({ emails_sent: 12, ncndas_signed: 1 }, { emails_sent: 20 });
  assert.equal(rows.length, SCORE_METRICS.length);
  const sent = rows.find((r) => r.key === "emails_sent")!;
  assert.deepEqual([sent.thisWeek, sent.lastWeek, sent.change.text], [12, 20, "−8"]);
  assert.equal(rows.find((r) => r.key === "ncndas_signed")!.change.dir, "up");
  assert.deepEqual(rows.map((r) => r.label).slice(-2), ["NCNDAs signed", "Fee letters signed"]);
});

test("tracking note only when tracking began after the period started", () => {
  assert.equal(trackedLate("2026-10-23T12:00:00Z", "2026-10-11T23:00:00.000Z"), true);
  assert.equal(trackedLate("2026-10-01T12:00:00Z", "2026-10-11T23:00:00.000Z"), false);
  assert.equal(trackedLate(null, "2026-10-11T23:00:00.000Z"), false);
});

test("a reject needs a reason from the list; Other needs a note", () => {
  assert.equal(REJECT_REASONS.length, 9);
  assert.equal(rejectProblem("", ""), "Pick a reason.");
  assert.equal(rejectProblem("because", "x"), "Pick a reason.");
  assert.equal(rejectProblem("wrong_geography", ""), null);
  assert.match(rejectProblem("other", "  ok ") ?? "", /Other/);
  assert.equal(rejectProblem("other", "Owner will not sell"), null);
  assert.match(rejectProblem("noise", "x".repeat(2001)) ?? "", /2,000/);
});

test("learned down-weights are shown in one line", () => {
  assert.equal(feedbackLine(undefined), null);
  assert.equal(feedbackLine({ adjustment: 0, notes: ["x"] }), null);
  assert.equal(feedbackLine({ adjustment: -8, notes: [] }), null);
  assert.equal(
    feedbackLine({ raw_total: 80, adjustment: -8, notes: ["2 similar rejected as wrong geography (country DE)"] }),
    "Down-weighted 8 points: 2 similar rejected as wrong geography (country DE)",
  );
});
