import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLabel, isNewer, shaFromHtml } from "../src/lib/version.ts";

test("shaFromHtml reads the nodus-build meta tag", () => {
  assert.equal(shaFromHtml('<head><meta name="nodus-build" content="abc1234" /></head>'), "abc1234");
  assert.equal(shaFromHtml("<head></head>"), null);
});

test("isNewer: only when both are known and differ; dev never nags", () => {
  assert.equal(isNewer("abc1234", "def5678"), true);
  assert.equal(isNewer("abc1234", "abc1234"), false);
  assert.equal(isNewer("abc1234", null), false);
  assert.equal(isNewer("dev", "def5678"), false);
});

test("buildLabel shows the SHA and the UK build time", () => {
  assert.equal(buildLabel("abc1234", "2026-10-27T10:05:00Z"), "Build abc1234 · 27 Oct, 10:05 UK");
  assert.equal(buildLabel("abc1234", ""), "Build abc1234");
});
