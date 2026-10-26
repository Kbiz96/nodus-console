import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BATCH_CAP, STAGES, WORK_TAIL, batches, canWork, dismissPayload, nextStep, oppLine, parseResearch, parseStage,
  restorePayload, sequencerChats, sequencerPrompt, stageIndex, type SeqOpp,
} from "../src/lib/sequencer.ts";
import { CHECK_FIRST } from "../src/lib/claude.ts";
import { NODUS_PROJECT_ID } from "../src/config.ts";

const opp = (n: number, extra: Partial<SeqOpp> = {}): SeqOpp => ({
  id: `0aaa0aaa-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
  title: `Site ${n}`,
  org: `Example Power ${n} Ltd`,
  evidence: `https://example.org/${n}`,
  ...extra,
});

test("the next-stage button label follows the stage", () => {
  const labels = Object.fromEntries(["found", "researched", "people", "drafted", "contacted", "conversation", "protected", "dismissed"].map((s) => [s, nextStep(parseStage(s)).label]));
  assert.deepEqual(labels, {
    found: "Research it",
    researched: "Find the people",
    people: "Draft outreach",
    drafted: "Review & send",
    contacted: "Draft follow-up",
    conversation: "Open the deal",
    protected: "Open the deal",
    dismissed: "Bring back",
  });
  assert.deepEqual(nextStep("found"), { kind: "claude", action: "research", label: "Research it" });
  assert.equal(nextStep("drafted").kind, "review");
  assert.equal(nextStep("conversation").kind, "deal");
});

test("stages parse safely and Work it stops before drafted", () => {
  assert.equal(parseStage("nonsense"), "found");
  assert.equal(parseStage(null), "found");
  assert.equal(stageIndex("dismissed"), -1);
  assert.equal(stageIndex("protected"), STAGES.length - 1);
  assert.deepEqual(STAGES.map(canWork), [true, true, true, false, false, false, false]);
  assert.equal(canWork("dismissed"), false);
});

test("each opportunity is one line with reference, id, organisation and evidence", () => {
  assert.equal(
    oppLine(opp(1, { id: "1a2b3c4d-1111-4111-8111-111111111111", title: "Ealing | 40 MW  site" })),
    "NOD-1A2B3C4D | Ealing / 40 MW site | opportunity_id 1a2b3c4d-1111-4111-8111-111111111111 | org Example Power 1 Ltd | evidence https://example.org/1",
  );
  assert.equal(oppLine({ id: "1a2b3c4d-1111-4111-8111-111111111111", title: null }).split(" | ").slice(3).join(" | "), "org unknown | evidence none linked");
});

test("Work it asks for every stage up to drafted; single steps say run only", () => {
  const w = sequencerPrompt("work", [opp(1), opp(2)]);
  assert.ok(w.startsWith("Nodus command (opportunity sequencer: Work it): take these 2 opportunities to drafted."));
  assert.ok(w.includes(oppLine(opp(1))) && w.includes(oppLine(opp(2))));
  assert.ok(w.endsWith(WORK_TAIL));
  assert.ok(WORK_TAIL.startsWith('Follow the nodus-command playbook section "Opportunity sequencer": run every stage from the current one up to drafted'));
  assert.ok(WORK_TAIL.endsWith("show me the drafts here and send the emails when I say send."));
  const r = sequencerPrompt("research", [opp(3)]);
  assert.ok(r.startsWith("Nodus command (opportunity sequencer: Research it): run only the research step for this opportunity."));
  assert.ok(r.includes('"Opportunity sequencer": run only the research step ('));
  assert.ok(sequencerPrompt("people", [opp(3)]).includes("run only the people step"));
  assert.ok(sequencerPrompt("follow-up", [opp(3)]).includes("run only the follow-up step"));
});

test("chats are capped at 15 opportunities, open in the Nodus project and carry the check-first line", () => {
  assert.equal(BATCH_CAP, 15);
  assert.deepEqual(batches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  const many = Array.from({ length: 32 }, (_, i) => opp(i + 1));
  const chats = sequencerChats("work", [...many, many[0]]);
  assert.deepEqual(chats.map((c) => c.ids.length), [15, 15, 2]);
  assert.equal(new Set(chats.flatMap((c) => c.ids)).size, 32);
  assert.ok(chats[0].text.includes("(batch 1 of 3; the other batches have their own chats)"));
  assert.ok(chats[2].text.includes("take these 2 opportunities to drafted (batch 3 of 3"));
  for (const c of chats) {
    assert.equal(c.full, true);
    const u = new URL(c.url);
    assert.equal(u.origin + u.pathname, "https://claude.ai/new");
    assert.equal(u.searchParams.get("project"), NODUS_PROJECT_ID);
    const q = u.searchParams.get("q") ?? "";
    assert.ok(q.startsWith("Nodus command (opportunity sequencer: Work it)"));
    assert.ok(q.endsWith(CHECK_FIRST));
  }
  const one = sequencerChats("research", [opp(1)]);
  assert.equal(one.length, 1);
  assert.ok(!one[0].text.includes("batch"));
});

test("dismiss upserts stage dismissed with the reason; undo puts it back to found", () => {
  const now = new Date("2026-10-26T10:00:00Z");
  assert.deepEqual(dismissPayload(["a", "b", "a"], "Broker chain", now), [
    { opportunity_id: "a", stage: "dismissed", dismissed_reason: "Broker chain", next_action: null, updated_at: "2026-10-26T10:00:00.000Z" },
    { opportunity_id: "b", stage: "dismissed", dismissed_reason: "Broker chain", next_action: null, updated_at: "2026-10-26T10:00:00.000Z" },
  ]);
  assert.deepEqual(restorePayload(new Map([["a", "researched"], ["b", "drafted"]]), now), [
    { opportunity_id: "a", stage: "researched", dismissed_reason: null, updated_at: "2026-10-26T10:00:00.000Z" },
    { opportunity_id: "b", stage: "found", dismissed_reason: null, updated_at: "2026-10-26T10:00:00.000Z" },
  ]);
});

test("research is read defensively", () => {
  assert.equal(parseResearch(null), null);
  assert.equal(parseResearch({}), null);
  const r = parseResearch({ summary: " A 40 MW site ", risks: ["Grid date", "Planning"], sources: ["https://a.example/x", "not a url", { url: "https://b.example" }] });
  assert.deepEqual(r, { summary: "A 40 MW site", what_they_need: null, value_exchange: null, angle: null, risks: "Grid date; Planning", sources: ["https://a.example/x", "https://b.example"] });
});
