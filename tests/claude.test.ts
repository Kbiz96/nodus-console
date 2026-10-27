import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAUDE_CUT_NOTE, CLAUDE_URL_MAX, claudeLink, claudeUrl } from "../src/lib/claude.ts";
import { NODUS_PROJECT_ID } from "../src/config.ts";

test("Claude links open a new chat in the Nodus project with the text encoded", () => {
  const url = claudeUrl("a & b: 50% (priority 1)?\n2. next");
  assert.equal(url, `https://claude.ai/new?q=a%20%26%20b%3A%2050%25%20(priority%201)%3F%0A2.%20next&project=${NODUS_PROJECT_ID}`);
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://claude.ai/new");
  assert.equal(u.searchParams.get("q"), "a & b: 50% (priority 1)?\n2. next");
  assert.equal(u.searchParams.get("project"), "01a0f3c4-b60e-7236-8dea-4bd5402220f3");
});

test("Claude links keep under the length limit by cutting the end, never by asking for a paste", () => {
  const short = claudeLink("hello");
  assert.equal(short.full, true);
  const long = "x".repeat(CLAUDE_URL_MAX);
  const r = claudeLink(long);
  assert.equal(r.full, false);
  assert.ok(r.url.length <= CLAUDE_URL_MAX);
  const q = new URL(r.url).searchParams.get("q") ?? "";
  assert.ok(q.startsWith("xxxx") && q.endsWith(CLAUDE_CUT_NOTE));
  assert.ok(!/clipboard|paste/i.test(q));
  const cmd = claudeLink(`Nodus command: draft for these people.\n${Array.from({ length: 400 }, (_, i) => `${i + 1}. Person ${i + 1}, Some Company Limited (contact_id ${i})`).join("\n")}`);
  const cq = new URL(cmd.url).searchParams.get("q") ?? "";
  assert.equal(cmd.full, false);
  assert.ok(cmd.url.length <= CLAUDE_URL_MAX);
  assert.ok(cq.startsWith("Nodus command: draft for these people.\n1. Person 1,") && cq.includes(CLAUDE_CUT_NOTE) && cq.includes("Before doing anything"));
  assert.ok(/\(contact_id \d+\)\n\n\[The rest/.test(cq), "cut at the end of a line");
  assert.equal(new URL(r.url).searchParams.get("project"), NODUS_PROJECT_ID);
  // encoding counts: 2,000 "&" become 6,000 characters, so 2,600 of them is too long
  assert.equal(claudeLink("&".repeat(2000)).full, true);
  assert.equal(claudeLink("&".repeat(2600)).full, false);
});

test("every Nodus command carries the check-what's-been-done line, once", async () => {
  const { withCheckFirst, CHECK_FIRST } = await import("../src/lib/claude.ts");
  const t = withCheckFirst("Nodus command (priority 1: X). Draft.");
  assert.ok(t.endsWith(CHECK_FIRST));
  assert.equal(withCheckFirst(t), t);
  assert.equal(withCheckFirst("hello"), "hello");
  assert.ok(decodeURIComponent(claudeUrl("Nodus command: go")).includes("Before doing anything"));
});
