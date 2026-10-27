import { test } from "node:test";
import assert from "node:assert/strict";
import {
  briefAction,
  briefIsEmpty,
  briefItems,
  briefMissingNote,
  couldDo,
  lineChip,
  liveItems,
  mergeDoNow,
  parseBrief,
  pipelineStrip,
  processNowPrompt,
} from "../src/lib/brief.ts";
import { writeOutboundPrompt } from "../src/lib/leads.ts";

test("brief: a full body parses", () => {
  const b = parseBrief({
    headline: "  Two calls decide the week ",
    calls: [{ time: "10:30", who: "Harlow Compute", goal: "Qualify" }],
    do_now: [{ text: "Send teaser", link: "#/review" }],
    could_do: [{ text: "Tidy list" }],
    mandates: [{ rank: 1, title: "Al-Risha", status: "signed", next: "LOI", overdue: true }],
    digest: ["a", "b"],
    rep: { q: "Q?", a: "A." },
  }, "2026-10-26");
  assert.equal(b.headline, "Two calls decide the week");
  assert.equal(b.day, "2026-10-26");
  assert.deepEqual(b.calls, [{ time: "10:30", who: "Harlow Compute", goal: "Qualify" }]);
  assert.deepEqual(b.do_now, [{ text: "Send teaser", link: "#/review" }]);
  assert.deepEqual(b.could_do, ["Tidy list"]);
  assert.equal(b.mandates[0].overdue, true);
  assert.deepEqual(b.rep, { q: "Q?", a: "A." });
});

test("brief: missing and malformed fields never throw", () => {
  for (const body of [null, undefined, 42, "not json", [], {}, { calls: "x", do_now: {}, digest: null, rep: "x" }]) {
    const b = parseBrief(body);
    assert.equal(b.headline, "");
    assert.deepEqual(b.calls, []);
    assert.deepEqual(b.do_now, []);
    assert.deepEqual(b.digest, []);
    assert.equal(b.rep, null);
    assert.equal(briefIsEmpty(b), true);
  }
  assert.equal(briefIsEmpty(null), true);
});

test("brief: strings are tolerated, blanks dropped, digest capped at four, rep needs a question", () => {
  const b = parseBrief(JSON.stringify({
    do_now: ["Chase fee letter", { text: "" }, { link: "#/x" }, { text: "With link", link: "" }],
    could_do: ["One", { text: "Two" }, 3, null],
    calls: ["Call Brightwater", { who: "", goal: "" }, { time: 9, who: "X" }],
    digest: ["1", "2", "", "3", "4", "5"],
    rep: { a: "answer only" },
    mandates: [{ title: "" }, { title: "M", rank: "" }],
  }));
  assert.deepEqual(b.do_now, [{ text: "Chase fee letter", link: null }, { text: "With link", link: null }]);
  assert.deepEqual(b.could_do, ["One", "Two", "3"]);
  assert.deepEqual(b.calls, [{ time: "", who: "Call Brightwater", goal: "" }, { time: "9", who: "X", goal: "" }]);
  assert.deepEqual(b.digest, ["1", "2", "3", "4"]);
  assert.equal(b.rep, null);
  assert.deepEqual(b.mandates, [{ rank: null, title: "M", status: "", next: "", overdue: false }]);
  assert.equal(briefIsEmpty(b), false);
});

test("brief: missing note follows UK time and weekends", () => {
  assert.equal(briefMissingNote(new Date("2026-10-26T05:00:00Z")), "Today’s brief arrives at 06:40."); // Mon 05:00 UK (GMT)
  assert.match(briefMissingNote(new Date("2026-10-26T09:00:00Z")), /^Today’s brief arrives at 06:40\. It isn’t in yet\.$/);
  assert.equal(briefMissingNote(new Date("2026-10-24T09:00:00Z")), "No brief at weekends. Live items are below.");
  assert.equal(briefMissingNote(new Date("2026-10-23T05:30:00Z")), "Today’s brief arrives at 06:40."); // Fri 06:30 BST
});

test("brief: link kinds", () => {
  assert.deepEqual(briefAction({ text: "x", link: "#/review" }).action, { kind: "route", to: "/review" });
  assert.deepEqual(briefAction({ text: "x", link: "/deals?id=1" }).action, { kind: "route", to: "/deals?id=1" });
  assert.equal(briefAction({ text: "x", link: "https://claude.ai/new?q=a" }).cta, "Open in Claude");
  assert.deepEqual(briefAction({ text: "x", link: "https://example.com" }).action, { kind: "href", href: "https://example.com" });
  assert.deepEqual(briefAction({ text: "Chase the fee letter.", link: null }).action, { kind: "claude", prompt: "Nodus command: Chase the fee letter." });
  assert.equal(briefAction({ text: "x", link: "javascript:alert(1)" }).action.kind, "claude");
  assert.equal(briefAction({ text: "x", link: "//evil.example" }).action.kind, "claude");
});

const brief3 = briefItems([{ text: "B1", link: null }, { text: "B2", link: null }, { text: "B3", link: null }]);

test("do now: urgent live items first, the brief keeps a slot, never more than three", () => {
  const live = liveItems({ mandateLeads: 11, backgroundLeads: 5, drafts: 4, replies: 2 });
  assert.deepEqual(live.map((l) => [l.key, l.urgent]), [["live-replies", true], ["live-drafts", true], ["live-leads", false]]);
  assert.equal(live[0].text, "Answer 2 replies");
  assert.equal(live[2].detail, "11 on signed mandates, 5 from background BD.");
  const { now, overflow } = mergeDoNow(brief3, live);
  assert.deepEqual(now.map((d) => d.text), ["Answer 2 replies", "Send 4 emails", "B1"]);
  assert.deepEqual(overflow.map((d) => d.text), ["B2", "B3", "Approve or dismiss 16 new leads"]);
});

test("do now: routine live items only fill spare slots; with no brief, live items take all three", () => {
  const leadsOnly = liveItems({ mandateLeads: 0, backgroundLeads: 3, drafts: 0, replies: 0 });
  assert.equal(leadsOnly[0].text, "Approve or dismiss 3 new leads");
  assert.deepEqual(leadsOnly[0].action, { kind: "route", to: "/leads" });
  assert.deepEqual(mergeDoNow(brief3.slice(0, 1), leadsOnly).now.map((d) => d.text), ["B1", "Approve or dismiss 3 new leads"]);
  const live = liveItems({ mandateLeads: 1, backgroundLeads: 0, drafts: 1, replies: 1 });
  assert.equal(live[0].text, "Answer 1 reply");
  assert.deepEqual(mergeDoNow([], live).now.map((d) => d.key), ["live-replies", "live-drafts", "live-leads"]);
  assert.deepEqual(mergeDoNow([], []), { now: [], overflow: [] });
  assert.deepEqual(liveItems({ mandateLeads: 0, backgroundLeads: 0, drafts: 0, replies: 0 }), []);
});

test("could do: overflow first, then the brief, five at most", () => {
  const { overflow } = mergeDoNow(brief3, liveItems({ mandateLeads: 2, backgroundLeads: 0, drafts: 1, replies: 1 }));
  const c = couldDo(overflow, ["C1", "C2", "C3", "C4"]);
  assert.deepEqual(c.map((x) => x.text), ["B2", "B3", "Approve or dismiss 2 new leads", "C1", "C2"]);
  assert.equal(c[3].item, null);
});

test("pipeline strip: counts by tier, leads waiting, unknowns left out", () => {
  assert.deepEqual(pipelineStrip({ routed: 32, background: 820, waiting: 5 }), [
    { n: "32", label: "routed to mandates" },
    { n: "820", label: "in background queue" },
    { n: "5", label: "leads waiting for you" },
    { n: "15", label: "processed each evening" },
  ]);
  assert.deepEqual(pipelineStrip({ routed: null, background: 1820, waiting: 1 }).map((s) => `${s.n} ${s.label}`), ["1,820 in background queue", "1 lead waiting for you", "15 processed each evening"]);
  assert.deepEqual(pipelineStrip({ routed: 0, background: 0, waiting: 0 }).map((s) => s.n), ["0", "0", "15"]);
});

test("background BD prompts and chips", () => {
  const p = processNowPrompt();
  assert.ok(p.startsWith("Nodus command: run background BD now. Take the next 25 from bd_queue (order by tier, bd_score desc)"));
  assert.ok(p.includes("priority_id = suggested_priority_id, source 'engine'"));
  assert.ok(p.endsWith("Report how many were queued per mandate."));
  const w = writeOutboundPrompt([{ id: "L1", name: "Rhea S***n", title: "MP", company: "Kestrel", source: "engine", source_ref: "ap1", opportunity_id: "O1" }], null);
  assert.ok(w.startsWith("Nodus command (background BD, no priority). Write best-in-class outbound for these 1 approved leads"));
  assert.ok(w.includes("Save drafts with no priority"));
  assert.ok(w.endsWith("1. Rhea S***n, MP, Kestrel (lead L1, engine ap1, opportunity O1)"));
  assert.equal(lineChip("capital"), "Capital");
  assert.equal(lineChip("powered_land"), "Powered land");
  assert.equal(lineChip("compute"), "Compute");
  assert.equal(lineChip(null), null);
});

test("brief items: vague links ('#/', '#/review') go to the right console place, stale counts become live", () => {
  const live = { mandateLeads: 3, backgroundLeads: 2, drafts: 12, replies: 0 };
  const [a, b, c, d, e] = briefItems([
    { text: "Review queue: 57 drafts waiting, incl. 20 Al-Risha investor drafts and 30 DIGGERS blind RFQs.", link: "#/review" },
    { text: "Reply to Makho on Project A: honest status of the blind brief.", link: "#/" },
    { text: "Approve or dismiss the 37 new leads (Al-Risha, convertible)", link: "#/" },
    { text: "Pick the first-wave investors to send to Mark", link: "#/" },
    { text: "Open the deals list", link: "#/deals" },
  ], live);
  assert.deepEqual(a.action, { kind: "scroll", target: "approve" });
  assert.equal(a.text, "Review queue: 12 drafts waiting.");
  assert.deepEqual(b.action, { kind: "scroll", target: "replies" });
  assert.deepEqual(c.action, { kind: "route", to: "/leads" });
  assert.equal(c.text, "Approve or dismiss the 5 new leads (Al-Risha, convertible)");
  assert.equal(d.action.kind, "claude");
  assert.deepEqual(e.action, { kind: "route", to: "/deals" });
  // Without live counts the stale number is dropped rather than shown.
  assert.equal(briefItems([{ text: "Review queue: 57 drafts waiting.", link: "#/review" }])[0].text, "Review queue: drafts waiting.");
});
