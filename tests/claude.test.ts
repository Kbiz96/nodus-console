import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAUDE_PASTE_NOTE, CLAUDE_URL_MAX, claudeLink, claudeUrl } from "../src/lib/claude.ts";
import { NODUS_PROJECT_ID } from "../src/config.ts";

test("Claude links open a new chat in the Nodus project with the text encoded", () => {
  const url = claudeUrl("a & b: 50% (priority 1)?\n2. next");
  assert.equal(url, `https://claude.ai/new?q=a%20%26%20b%3A%2050%25%20(priority%201)%3F%0A2.%20next&project=${NODUS_PROJECT_ID}`);
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://claude.ai/new");
  assert.equal(u.searchParams.get("q"), "a & b: 50% (priority 1)?\n2. next");
  assert.equal(u.searchParams.get("project"), "01a0f3c4-b60e-7236-8dea-4bd5402220f3");
});

test("Claude links keep under the length limit and fall back to a paste note", () => {
  const short = claudeLink("hello");
  assert.equal(short.full, true);
  const long = "x".repeat(CLAUDE_URL_MAX);
  const r = claudeLink(long);
  assert.equal(r.full, false);
  assert.ok(r.url.length <= CLAUDE_URL_MAX);
  assert.equal(new URL(r.url).searchParams.get("q"), CLAUDE_PASTE_NOTE);
  assert.equal(new URL(r.url).searchParams.get("project"), NODUS_PROJECT_ID);
  // encoding counts: 2,000 "&" become 6,000 characters, so 2,600 of them is too long
  assert.equal(claudeLink("&".repeat(2000)).full, true);
  assert.equal(claudeLink("&".repeat(2600)).full, false);
});
