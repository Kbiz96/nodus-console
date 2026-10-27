import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decide,
  decisionPatch,
  findMorePrompt,
  leadQueues,
  moveCursor,
  newLeadCounts,
  sortLeads,
  sourceLabel,
  writeOutboundPrompt,
  type Lead,
  type LeadOverrides,
} from "../src/lib/leads.ts";
import { claudeLink } from "../src/lib/claude.ts";

const P1 = "abababab-0000-4000-8000-000000000001";
const P2 = "abababab-0000-4000-8000-000000000002";

function lead(id: string, over: Partial<Lead> = {}): Lead {
  return {
    id, priority_id: P1, name: `Lead ${id}`, title: "Head of Capacity", company: "Example Cloud", company_domain: null,
    linkedin: null, country: "AE", source: "apollo", source_ref: `ap-${id}`, hook: null, hook_url: null,
    fit_score: 80, fit_reason: "Runs capacity for a GCC neocloud", status: "new", contact_id: null, decided_at: null,
    created_at: "2026-10-26T06:00:00Z", ...over,
  };
}

test("leads: best fit first, no score last, then newest, then name", () => {
  const rows = [
    lead("a", { fit_score: 72 }),
    lead("b", { fit_score: null }),
    lead("c", { fit_score: 92 }),
    lead("d", { fit_score: 72, created_at: "2026-10-26T07:00:00Z" }),
    lead("e", { fit_score: 72, name: "Aaron" }),
  ];
  assert.deepEqual(sortLeads(rows).map((r) => r.id), ["c", "d", "e", "a", "b"]);
});

test("leads: queues split new and approved for one priority, with on-screen decisions", () => {
  const rows = [lead("a", { fit_score: 70 }), lead("b", { fit_score: 90 }), lead("c", { status: "approved" }), lead("z", { priority_id: P2 })];
  const q0 = leadQueues(rows, P1);
  assert.deepEqual(q0.fresh.map((r) => r.id), ["b", "a"]);
  assert.deepEqual(q0.approved.map((r) => r.id), ["c"]);

  // approve b, dismiss a
  let over: LeadOverrides = decide(new Map(), ["b"], "approved");
  over = decide(over, ["a"], "dismissed");
  const q1 = leadQueues(rows, P1, over);
  assert.deepEqual(q1.fresh.map((r) => r.id), []);
  assert.deepEqual(q1.approved.map((r) => r.id), ["b", "c"]);

  // Undo puts b back in the queue; the original map is untouched
  const undone = decide(over, ["b"], "new");
  assert.deepEqual(leadQueues(rows, P1, undone).fresh.map((r) => r.id), ["b"]);
  assert.equal(over.get("b"), "approved");
});

test("leads: new counts per priority follow decisions", () => {
  const rows = [lead("a"), lead("b"), lead("c", { status: "approved" }), lead("z", { priority_id: P2 })];
  assert.deepEqual([...newLeadCounts(rows)], [[P1, 2], [P2, 1]]);
  assert.deepEqual([...newLeadCounts(rows, decide(new Map(), ["a", "z"], "dismissed"))], [[P1, 1]]);
});

test("leads: approve and dismiss stamp decided_at; Undo clears it", () => {
  const now = new Date("2026-10-26T09:00:00Z");
  assert.deepEqual(decisionPatch("approved", now), { status: "approved", decided_at: "2026-10-26T09:00:00.000Z" });
  assert.deepEqual(decisionPatch("dismissed", now), { status: "dismissed", decided_at: "2026-10-26T09:00:00.000Z" });
  assert.deepEqual(decisionPatch("new", now), { status: "new", decided_at: null });
});

test("leads: source labels and J/K cursor", () => {
  assert.equal(sourceLabel("apollo"), "Apollo");
  assert.equal(sourceLabel("8raise"), "8Raise");
  assert.equal(sourceLabel("web"), "Web");
  assert.equal(moveCursor(0, -1, 5), 0);
  assert.equal(moveCursor(3, 1, 5), 4);
  assert.equal(moveCursor(4, 1, 5), 4);
  assert.equal(moveCursor(2, 1, 0), 0);
});

const pr = { rank: 1, title: "Al-Risha phase 1: find the offtaker", who: "Neoclouds and AI labs needing 50 MW+ in the Middle East", goal: "Signed LOI from an offtaker for phase 1 (50 MW)" };

test("leads: Write outbound lists every lead with its id and source_ref", () => {
  const q = writeOutboundPrompt([
    lead("11111111-0000-4000-8000-000000000001", { name: "Steve St***t", title: "VP Capacity", company: "Northwind Compute", source_ref: "64a1b2" }),
    lead("11111111-0000-4000-8000-000000000002", { name: "Amira Saleh", source: "8raise", source_ref: null }),
  ], pr);
  assert.ok(q.startsWith("Nodus command (priority 1: Al-Risha phase 1: find the offtaker). Write best-in-class outbound for these 2 approved leads (lead_candidates ids below)."));
  assert.ok(q.includes("enrich with Apollo by source_ref (work email, full name, LinkedIn; report credits)"));
  assert.ok(q.includes("set each lead's status to 'drafted' and contact_id"));
  assert.ok(q.includes("Blind brief only, no client names, no fees"));
  assert.ok(q.includes("a LinkedIn DM only if they are already a 1st-degree connection, and I send it myself"));
  assert.ok(q.includes("OUTBOUND-PROMPT v3"));
  assert.ok(!q.includes("when I reply"));
  assert.ok(q.includes("\n1. Steve St***t, VP Capacity, Northwind Compute (lead 11111111-0000-4000-8000-000000000001, apollo 64a1b2)"));
  assert.ok(q.includes("\n2. Amira Saleh, Head of Capacity, Example Cloud (lead 11111111-0000-4000-8000-000000000002)"));
  const link = claudeLink(q);
  const u = new URL(link.url);
  assert.equal(link.full, true);
  assert.equal(u.origin + u.pathname, "https://claude.ai/new");
  assert.equal(u.searchParams.get("project"), "01a0f3c4-b60e-7236-8dea-4bd5402220f3");
  assert.ok(u.searchParams.get("q")?.includes("apollo 64a1b2"));
});

test("leads: Find 50 more asks for a deep scout with who and goal, in the Nodus project", () => {
  const q = findMorePrompt(pr);
  assert.ok(q.startsWith("Nodus command (priority 1: Al-Risha phase 1: find the offtaker). Deep lead scout: find the 50 best people in the world"));
  assert.ok(q.includes('Who we need: "Neoclouds and AI labs needing 50 MW+ in the Middle East". Goal: "Signed LOI from an offtaker for phase 1 (50 MW)".'));
  assert.ok(q.includes("insert the top 50 into lead_candidates (status 'new')"));
  assert.ok(q.includes("network_dismissals for this priority"));
  assert.ok(q.endsWith("Tell me how many you added and the top 10."));
  assert.ok(findMorePrompt({ ...pr, who: null, goal: null }).includes('Who we need: "Al-Risha phase 1: find the offtaker"'));
  const u = new URL(claudeLink(q).url);
  assert.equal(u.searchParams.get("project"), "01a0f3c4-b60e-7236-8dea-4bd5402220f3");
  assert.ok(u.searchParams.get("q")?.includes("Before doing anything: search what has already been done"));
});
