import { test } from "node:test";
import assert from "node:assert/strict";
import { OLD_STYLE_NOTE, companyClashes, deckGroups, emailDomain, frontGroup, holdNote } from "../src/lib/deck.ts";

test("holdNote appends the reason with the UK date", () => {
  const d = new Date("2026-10-27T10:00:00Z");
  assert.equal(holdNote("research", "same_firm", "", d), "research | held 27 Oct: Second contact at same firm");
  assert.equal(holdNote(null, "other", "waiting on NCNDA", d), "held 27 Oct: Other: waiting on NCNDA");
  assert.equal(OLD_STYLE_NOTE, " | parked 27 Oct: old style");
});

test("one per company: higher fit kept, personal mailboxes never clash", () => {
  assert.equal(emailDomain("Jo@Example.com"), "example.com");
  assert.equal(emailDomain("jo@gmail.com"), null);
  const rows = [{ id: "a", to_email: "a@x.com" }, { id: "b", to_email: "b@x.com" }, { id: "c", to_email: "c@gmail.com" }, { id: "d", to_email: "d@gmail.com" }];
  const c = companyClashes(rows, new Map([["a", 60], ["b", 80]]));
  assert.deepEqual(c.get("a"), { domain: "x.com", keep: "b", others: ["a"] });
  assert.equal(c.has("c"), false);
  const tie = companyClashes(rows.slice(0, 2), new Map());
  assert.equal(tie.get("b")?.keep, "a", "a tie keeps the first in the queue");
});

test("deckGroups: by mandate in deck order with counts, no mandate last; frontGroup moves one group up", () => {
  const ps = [{ id: "p1", rank: 1, title: "Al-Risha" }, { id: "p2", rank: 2, title: "GPU" }];
  const rows = [{ id: "1", priority_id: null }, { id: "2", priority_id: "p2" }, { id: "3", priority_id: "p1" }, { id: "4", priority_id: "p2" }];
  const g = deckGroups(rows, ps);
  assert.deepEqual(g.map((x) => [x.label, x.ids.length]), [["2. GPU", 2], ["1. Al-Risha", 1], ["No mandate", 1]]);
  assert.deepEqual(frontGroup(["1", "2", "3", "4"], ["3"]), ["3", "1", "2", "4"]);
});
