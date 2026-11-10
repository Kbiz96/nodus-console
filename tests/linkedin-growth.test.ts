import { test } from "node:test";
import assert from "node:assert/strict";
import { GROWTH_ACTIONS, PAGE_COMPOSE_URL, PERSONAL_COMPOSE_URL, firstComment, postComposeUrl, postTarget, postType, publishSlot } from "../src/lib/linkedinGrowth.ts";
import { claudeLink } from "../src/lib/claude.ts";

test("six growth buttons, each a full Nodus command that fits in one link", () => {
  assert.deepEqual(GROWTH_ACTIONS.map((a) => a.key), ["comment", "network", "posts", "engagers", "magnet", "scorecard"]);
  for (const a of GROWTH_ACTIONS) {
    assert.ok(a.prompt.startsWith("Nodus command: LinkedIn growth"), a.key);
    assert.ok(a.prompt.includes("LINKEDIN-STANDARD.md"), a.key);
    assert.ok(a.prompt.includes("never click"), `${a.key} must stay read-only`);
    assert.ok(a.prompt.includes("tfsioiuvmyuqgajxtklv") && !a.prompt.includes("wryvidauwmcczbmstsla"), a.key);
    assert.equal(claudeLink(a.prompt).full, true, `${a.key} link was cut`);
  }
});

test("post drafts: page or personal, compose link, first comment, slot, type", () => {
  const page = { to_name: "Nodus Partners (page)", note: "LI: POST · PAGE · NEWS · Publish Wed 08:00 UK · First comment: https://nodus.partners" };
  const mine = { to_name: "Kuran (personal)", note: "LI: POST · PERSONAL · MAGNET · Publish Tue 08:00 UK · First comment: none" };
  assert.equal(postTarget(page), "page");
  assert.equal(postTarget(mine), "personal");
  assert.equal(postComposeUrl(page), PAGE_COMPOSE_URL);
  assert.equal(postComposeUrl(mine), PERSONAL_COMPOSE_URL);
  assert.equal(firstComment(page.note), "https://nodus.partners");
  assert.equal(firstComment(mine.note), null);
  assert.equal(firstComment(null), null);
  assert.equal(publishSlot(page.note), "Wed 08:00 UK");
  assert.equal(postType(mine.note), "MAGNET");
  assert.equal(postType("something else"), null);
});
