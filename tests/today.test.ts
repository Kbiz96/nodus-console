import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEND_OFF_TEXT, SEND_ON_TEXT, approvedText, connectionNote, isConnected, nudgePrompt, overdueLabel, pipelineRows, repliesOwed,
  sendStatusText, splitLinkedIn,
} from "../src/lib/today.ts";
import { briefAction, focusSession, briefItems, liveItems, parseBrief, sessionPrompt } from "../src/lib/brief.ts";

test("send status: only an explicit true says emails go out; false, missing or odd values say paused", () => {
  assert.equal(sendStatusText(true), "Approved emails go out at 09:53, 12:53 and 15:53.");
  assert.equal(sendStatusText(true), SEND_ON_TEXT);
  for (const v of [false, null, undefined, "true", 1, {}]) assert.equal(sendStatusText(v), SEND_OFF_TEXT);
  assert.equal(SEND_OFF_TEXT, "Sending is paused. Approved emails wait until Kuran turns sending on (ask Claude: 'turn sending on').");
  assert.equal(approvedText("Alex", true, "12:53 today"), "Approved Alex. Sends at 12:53 today.");
  assert.equal(approvedText("Alex", null, "12:53 today"), "Approved Alex. It waits until sending is turned on.");
  assert.equal(approvedText(null, false, "x"), "Approved the email. It waits until sending is turned on.");
});

test("the brief carries send_enabled and replies; unknown stays unknown", () => {
  const b = parseBrief({ headline: "H", send_enabled: true, replies: [
    { who: "Dana", company: "Penguin", summary: "Asked for slots", gmail_draft_url: "https://mail.google.com/mail/u/0/#drafts/abc" },
    { who: "Eve", company: "", summary: "", gmail_draft_url: "javascript:alert(1)" },
    { who: "", company: "" },
  ] });
  assert.equal(b.send_enabled, true);
  assert.equal(b.replies.length, 2);
  assert.equal(b.replies[1].gmail_draft_url, null);
  assert.equal(parseBrief({ send_enabled: "yes" }).send_enabled, null);
  assert.equal(parseBrief({ send_enabled: false }).send_enabled, false);
  assert.equal(parseBrief({}).send_enabled, null);
  // the live drafts item repeats the honest line
  assert.equal(liveItems({ mandateLeads: 0, backgroundLeads: 0, drafts: 2, replies: 0 }, false)[0].detail, SEND_OFF_TEXT);
  assert.equal(liveItems({ mandateLeads: 0, backgroundLeads: 0, drafts: 2, replies: 0 }, true)[0].detail, SEND_ON_TEXT);
  assert.equal(liveItems({ mandateLeads: 0, backgroundLeads: 0, drafts: 2, replies: 0 })[0].detail, SEND_OFF_TEXT);
});

test("focus session: the brief's items (three at most), Gmail links open the draft, one Claude chat for the rest", () => {
  assert.deepEqual(briefAction({ text: "Answer Penguin", link: "https://mail.google.com/mail/u/0/#drafts/x1" }), { action: { kind: "href", href: "https://mail.google.com/mail/u/0/#drafts/x1" }, cta: "Open draft in Gmail" });
  const brief = briefItems([{ text: "A", link: "#/pipeline" }, { text: "B", link: null }, { text: "C", link: null }, { text: "D", link: null }]);
  const live = liveItems({ mandateLeads: 0, backgroundLeads: 0, drafts: 3, replies: 1 });
  const s = focusSession(brief, live);
  assert.deepEqual(s.now.map((d) => d.text), ["A", "B", "C"]);
  assert.deepEqual(s.overflow.map((d) => d.text), ["D"]);
  assert.deepEqual(focusSession([], live).now.map((d) => d.key), ["live-replies", "live-drafts"]);
  const p = sessionPrompt(s.now.filter((d) => d.action.kind === "claude"));
  assert.ok(p.startsWith("Nodus command: focus session. Do these 2 for me in order"));
  assert.ok(p.endsWith("\n1. B\n2. C"));
  assert.ok(!/clipboard|paste/i.test(p));
});

test("LinkedIn: only connected people get a DM; everyone else waits for a connection note", () => {
  const rows = [
    { id: "1", channel: "linkedin", kind: "dm", contact_id: "c1", note: "Research. CONNECTED (1st degree).", body: "Hi" },
    { id: "2", channel: "linkedin", kind: "dm", contact_id: "c2", note: "Cold Apollo lead.\nIf not connected, send this note first: \"Hi Sam, we work on AI power. Keen to connect.\"\n\nMore", body: "Thanks for connecting" },
    { id: "3", channel: "linkedin", kind: "dm", contact_id: "c3", note: null, body: "Hi" },
    { id: "4", channel: "linkedin", kind: "dm", contact_id: "c4", note: "NOT CONNECTED yet", body: "Hi" },
    { id: "5", channel: "linkedin", kind: "comment", contact_id: null, note: "CONNECTED", body: "Great post" },
    { id: "6", channel: "email", kind: "email", contact_id: "c1", note: "CONNECTED", body: "Email" },
    { id: "7", channel: "linkedin", kind: "connect", contact_id: "c5", note: "CONNECTED", body: "Hello, keen to connect." },
  ];
  const notes = new Map<string, string | null>([["c3", "2026-10-20: LinkedIn connected"], ["c4", "not LinkedIn connected"]]);
  const { ready, waiting } = splitLinkedIn(rows, notes);
  assert.deepEqual(ready.map((r) => r.id), ["1", "3"]);
  assert.deepEqual(waiting.map((r) => r.id), ["2", "4", "7"]);
  assert.equal(connectionNote(rows[1]), "Hi Sam, we work on AI power. Keen to connect.");
  assert.equal(connectionNote(rows[3]), null);
  assert.equal(connectionNote(rows[6]), "Hello, keen to connect.");
  assert.equal(isConnected("RECONNECTED? no", null), false);
  assert.equal(isConnected(null, "LinkedIn Connected 3 Oct"), true);
});

test("pipeline: stalled first (most overdue first, then no date), closed deals out, cold contacts out", () => {
  const today = "2026-10-27";
  const deals = [
    { id: "d1", deal: "Perena intro", counterparty: "Perena", stage: "Qualified", next_step: "Fee letter", next_date: "2026-10-08", contact_id: "p1" },
    { id: "d2", deal: "Colovore", counterparty: "Colovore", stage: "Lead", next_step: "Call", next_date: "2026-10-26", contact_id: null },
    { id: "d3", deal: "Future", counterparty: "Later Ltd", stage: "Lead", next_step: "Send deck", next_date: "2026-11-03", contact_id: null },
    { id: "d4", deal: "Dead", counterparty: "Gone", stage: "Closed – lost", next_step: null, next_date: "2026-10-01", contact_id: null },
    { id: "d5", deal: "Today", counterparty: "Due Today", stage: "Lead", next_step: "Ring", next_date: today, contact_id: null },
    { id: "d6", deal: "Undated", counterparty: "No Date", stage: "Lead", next_step: "", next_date: null, contact_id: null },
  ];
  const contacts = [
    { id: "c1", name: "Mark", company: "Mindstream", stage: "Meeting", next_follow_up: "2026-10-20", email: "m@x.com", last_activity: null },
    { id: "c2", name: "Ash", company: "DAITS", stage: "Replied", next_follow_up: null, email: null, last_activity: null },
    { id: "c3", name: "Cold", company: "Cold Co", stage: "Contacted", next_follow_up: "2026-10-01", email: null, last_activity: null },
    { id: "c4", name: "Fine", company: "Fine Co", stage: "Qualified", next_follow_up: "2026-11-02", email: null, last_activity: null },
  ];
  const people = [{ id: "p1", name: "George", company: "Perena", stage: "Contacted", next_follow_up: null, email: "g@perena.example", last_activity: null }];
  const rows = pipelineRows(deals, contacts, today, people);
  assert.deepEqual(rows.map((r) => r.id), ["d1", "c1", "d2", "d5", "c2", "c4", "d3", "d6"]);
  assert.deepEqual(rows.map((r) => r.stalled), [true, true, true, true, true, false, false, false]);
  assert.equal(rows[0].who, "George");
  assert.equal(rows[0].email, "g@perena.example");
  assert.equal(rows[0].overdue, 19);
  assert.equal(overdueLabel(rows[0]), "19 days overdue");
  assert.equal(overdueLabel(rows.find((r) => r.id === "d5")!), "Due today");
  assert.equal(overdueLabel(rows.find((r) => r.id === "c2")!), "No date set");
  assert.equal(overdueLabel(rows.find((r) => r.id === "d2")!), "1 day overdue");
  const p = nudgePrompt(rows[0]);
  assert.ok(p.startsWith('Nodus command: draft the nudge to George at Perena (g@perena.example) about the deal "Perena intro", next step "Fee letter". It is 19 days overdue (was due 2026-10-08).'));
  assert.ok(p.includes("Save it as a Gmail draft in that same thread (do not send)"));
});

test("replies owed: the brief's list with Gmail drafts, plus logged replies it does not mention", () => {
  const owed = repliesOwed(
    [{ who: "Dana Reed", company: "Penguin", summary: "Wants two slots", gmail_draft_url: "https://mail.google.com/mail/u/0/#drafts/d1" }, { who: "Ash", company: "DAITS", summary: "", gmail_draft_url: null }],
    [
      { id: "o1", to_name: "dana reed", to_email: "dana@penguin.example", company: "Penguin", subject: "Hi", replied_at: null },
      { id: "o2", to_name: "Alex Example", to_email: "alex@example.com", company: "Example Power Ltd", subject: "Capacity in Jordan", replied_at: null },
    ],
  );
  assert.deepEqual(owed.map((o) => [o.who, o.ready]), [["Dana Reed", true], ["Ash", false], ["Alex Example", false]]);
  assert.equal(owed[0].url, "https://mail.google.com/mail/u/0/#drafts/d1");
  assert.equal(owed[2].url, "https://mail.google.com/mail/u/0/#search/alex%40example.com");
  assert.equal(owed[2].summary, "Replied to “Capacity in Jordan”");
  assert.deepEqual(repliesOwed([], []), []);
});
