import { test } from "node:test";
import assert from "node:assert/strict";
import { mondayOf, pickDay, practicePrompt, streak, weekDays, type LearnDay } from "../src/lib/learnweek.ts";

const d = (day: string, domain = false, voice = false): LearnDay => ({
  day, theme: null, domain_ref: "x", domain_part: 0, domain_title: "t", voice_ref: "v",
  domain_done_at: domain ? "2026-11-09T08:00:00Z" : null, voice_done_at: voice ? "2026-11-09T08:00:00Z" : null,
  win: null, know: null, ask: null,
});

test("mondayOf and weekDays run Monday to Sunday", () => {
  assert.equal(mondayOf("2026-11-15"), "2026-11-09");
  assert.equal(mondayOf("2026-11-09"), "2026-11-09");
  assert.equal(mondayOf("2026-11-08"), "2026-11-02");
  assert.deepEqual(weekDays("2026-11-09"), ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
});

test("pickDay: today if planned, else the next planned day, else the latest", () => {
  const rows = [d("2026-11-09"), d("2026-11-10")];
  assert.equal(pickDay(rows, "2026-11-10"), "2026-11-10");
  assert.equal(pickDay(rows, "2026-11-08"), "2026-11-09");
  assert.equal(pickDay(rows, "2026-11-20"), "2026-11-10");
  assert.equal(pickDay([], "2026-11-08"), null);
});

test("streak counts complete days ending today, or yesterday while today is open", () => {
  const rows = [d("2026-11-09", true, true), d("2026-11-10", true, true), d("2026-11-11", true, false)];
  assert.equal(streak(rows, "2026-11-11"), 2);
  assert.equal(streak(rows, "2026-11-10"), 2);
  assert.equal(streak([...rows.slice(0, 2), d("2026-11-11", true, true)], "2026-11-11"), 3);
  assert.equal(streak(rows, "2026-11-13"), 0);
});

test("practicePrompt keeps the Nodus rules and asks for a scorecard", () => {
  const p = practicePrompt("Answer first", "Lead with the answer.", "Monday");
  assert.ok(p.includes("Answer first") && p.includes("scorecard"));
  assert.ok(p.includes("no fees") && p.includes("introductions only"));
});
