import { test } from "node:test";
import assert from "node:assert/strict";
import { activeInOrder, deckOrder, greeting, isLinkedIn, nextSendSlot, priorityPrompt, replyPrompt, ukLongDate } from "../src/lib/focus.ts";
import { DEFAULT_LINES, linesParam, parseLines } from "../src/lib/labels.ts";

test("next send slot: the next weekday slot after now, in UK time", () => {
  // Friday 23 Oct 2026 is British Summer Time (UTC+1).
  assert.equal(nextSendSlot(new Date("2026-10-23T07:00:00Z")).label, "09:53 today"); // 08:00 UK
  assert.equal(nextSendSlot(new Date("2026-10-23T11:00:00Z")).label, "12:53 today"); // 12:00 UK
  assert.equal(nextSendSlot(new Date("2026-10-23T11:53:00Z")).label, "15:53 today"); // 12:53 UK: that batch has started
  assert.equal(nextSendSlot(new Date("2026-10-23T11:52:00Z")).label, "12:53 today");
  // Friday 16:00 UK: nothing until Monday.
  const fri = nextSendSlot(new Date("2026-10-23T15:00:00Z"));
  assert.equal(fri.label, "09:53 on Monday");
  assert.equal(fri.day, "2026-10-26");
  // Saturday and Sunday go to Monday.
  assert.equal(nextSendSlot(new Date("2026-10-24T10:00:00Z")).label, "09:53 on Monday");
  // Sunday 25 Oct: the clocks go back. Late Sunday evening UK is still Sunday.
  assert.equal(nextSendSlot(new Date("2026-10-25T22:30:00Z")).label, "09:53 tomorrow");
  // Monday 26 Oct, GMT again: 09:30 UTC is 09:30 UK, so 09:53 is still to come.
  assert.equal(nextSendSlot(new Date("2026-10-26T09:30:00Z")).label, "09:53 today");
  // Tuesday evening after the last slot: Wednesday morning.
  const tue = nextSendSlot(new Date("2026-10-27T18:00:00Z"));
  assert.equal(tue.label, "09:53 tomorrow");
  assert.equal(tue.time, "09:53");
  // 23:30 UTC in summer is already the next UK day.
  assert.equal(nextSendSlot(new Date("2026-06-30T23:30:00Z")).label, "09:53 today"); // Wed 1 Jul 00:30 UK
});

const P = [
  { id: "p1", rank: 1, status: "active" as const, title: "Al-Risha" },
  { id: "p2", rank: 2, status: "active" as const, title: "Mindstream" },
  { id: "p5", rank: 5, status: "active" as const, title: "Optio" },
  { id: "px", rank: 0, status: "paused" as const, title: "Paused one" },
];

test("deck order: priority rank first, then untagged; oldest first within a group", () => {
  const items = [
    { id: "a", created_at: "2026-10-20T08:00:00Z", priority_id: null },
    { id: "b", created_at: "2026-10-22T08:00:00Z", priority_id: "p5" },
    { id: "c", created_at: "2026-10-23T08:00:00Z", priority_id: "p1" },
    { id: "d", created_at: "2026-10-21T08:00:00Z", priority_id: "p1" },
    { id: "e", created_at: "2026-10-19T08:00:00Z", priority_id: "px" }, // paused: counts as untagged
    { id: "f", created_at: "2026-10-18T08:00:00Z", priority_id: "gone" }, // unknown priority: untagged
    { id: "g", created_at: "2026-10-22T09:00:00Z", priority_id: "p2" },
  ];
  assert.deepEqual(deckOrder(items, P).map((x) => x.id), ["d", "c", "g", "b", "f", "e", "a"]);
  assert.deepEqual(deckOrder([], P), []);
  // the input is not changed
  assert.equal(items[0].id, "a");
});

test("active priorities in rank order", () => {
  assert.deepEqual(activeInOrder(P).map((p) => p.id), ["p1", "p2", "p5"]);
});

test("LinkedIn is told apart from email", () => {
  assert.equal(isLinkedIn({ channel: "linkedin", kind: "dm" }), true);
  assert.equal(isLinkedIn({ channel: "email", kind: "email" }), false);
  assert.equal(isLinkedIn({ channel: null, kind: "connect" }), true);
  assert.equal(isLinkedIn({ channel: null, kind: "followup" }), false);
});

const AL = { rank: 1, title: "Al-Risha phase 1: find the offtaker", goal: "Signed LOI from an offtaker for phase 1", who: "Neoclouds and AI labs needing 50 MW+ in the Middle East", next_action: "Reach 25 neoclouds with the anonymised teaser." };

test("Claude prompt: the next action, who we need, the playbook and the tag", () => {
  assert.equal(
    priorityPrompt(AL),
    "Nodus command (priority 1: Al-Risha phase 1: find the offtaker): Reach 25 neoclouds with the anonymised teaser. Who we need: Neoclouds and AI labs needing 50 MW+ in the Middle East. Follow the nodus-command playbook: check the CRM, find people, draft for my approval, tag drafts with priority 1.",
  );
  // missing who and next action still read cleanly
  assert.equal(
    priorityPrompt({ rank: 3, title: "  SE Wisconsin  site ", goal: null, who: null, next_action: null }),
    "Nodus command (priority 3: SE Wisconsin site): decide the next step. Follow the nodus-command playbook: check the CRM, find people, draft for my approval, tag drafts with priority 3.",
  );
  assert.match(priorityPrompt(AL, "find"), /^Nodus command \(priority 1: .+\): find 25 more people we should reach\. Who we need: .+ tag drafts with priority 1\.$/);
  assert.match(priorityPrompt(AL, "followups"), /draft follow-ups for everyone .+ tag drafts with priority 1\.$/);
  assert.match(priorityPrompt(AL, "blocking"), /what's blocking this\? Goal: Signed LOI from an offtaker for phase 1\. .+Do not send anything\.$/);
  assert.match(priorityPrompt(AL, "summary"), /summarise where we are\. Goal: /);
});

test("reply prompt names the contact and the thread", () => {
  assert.equal(
    replyPrompt({ to_name: "Jane Smith", company: "Example Cloud", subject: "Re: 50 MW in Jordan", replied_at: "2026-10-22T10:00:00Z" }, 1, "22 Oct 2026"),
    'Nodus command: draft a reply to Jane Smith at Example Cloud. The thread is "Re: 50 MW in Jordan". They replied on 22 Oct 2026. Follow the nodus-command playbook: read the thread in Gmail and check the CRM, draft the reply for my approval, tag it with priority 1. Do not send anything.',
  );
  assert.match(replyPrompt({ to_name: null, company: null, subject: null, replied_at: null }), /^Nodus command: draft a reply to this contact\. Follow/);
});

test("greeting and date in UK time", () => {
  assert.equal(greeting(new Date("2026-10-23T07:30:00Z")), "Good morning");
  assert.equal(greeting(new Date("2026-10-23T12:30:00Z")), "Good afternoon");
  assert.equal(greeting(new Date("2026-10-23T17:30:00Z")), "Good evening"); // 18:30 UK
  assert.equal(ukLongDate(new Date("2026-10-23T12:00:00Z")), "Friday 23 October");
});

test("Map line filter: critical power off by default, 'all' brings it back", () => {
  assert.deepEqual([...parseLines(null)].sort(), [...DEFAULT_LINES].sort());
  assert.equal(parseLines(null).has("critical_power"), false);
  assert.equal(parseLines("all").has("critical_power"), true);
  assert.deepEqual([...parseLines("compute,nonsense")], ["compute"]);
  assert.equal(linesParam(new Set(DEFAULT_LINES)), null);
  assert.equal(linesParam(new Set(["critical_power", "compute", "capital", "powered_land"])), "all");
  assert.equal(linesParam(new Set(["capital", "compute"])), "compute,capital");
  assert.equal(linesParam(new Set()), null);
});
