import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  batchDraftPrompt,
  dealNext,
  dismissalRows,
  dismissedIds,
  isActiveDismissal,
  withoutDismissed,
  enrichPrompt,
  groupPriorities,
  isParked,
  isSupplyPriority,
  networkHeading,
  quotesPrompt,
  scoreWidth,
  signedState,
  splitVisible,
  titleHead,
  withoutParked,
  workstreamLabel,
} from "../src/lib/mandates.ts";
import { DECK_STATUSES } from "../src/lib/focus.ts";

// ---------- signed badge ----------

test("signed badge: fee and NCNDA both signed", () => {
  const s = signedState([{ ncnda_signed: "Yes", fee_signed: "Yes" }]);
  assert.equal(s.state, "signed");
  assert.equal(s.badge, "Signed");
  assert.deepEqual(s.chips.map((c) => c.label), ["Fee protected ✓", "NCNDA ✓"]);
  assert.ok(s.chips.every((c) => c.tone === "ok"));
});

test("signed badge: NCNDA signed, fee not applicable shows no fee chip", () => {
  const s = signedState([{ ncnda_signed: "Yes", fee_signed: "N/A" }]);
  assert.equal(s.badge, "Signed");
  assert.deepEqual(s.chips.map((c) => c.label), ["NCNDA ✓"]);
});

test("signed badge: NCNDA signed, fee letter outstanding", () => {
  const s = signedState([{ ncnda_signed: "yes", fee_signed: "No" }]);
  assert.equal(s.state, "signed");
  assert.deepEqual(s.chips, [{ label: "NCNDA ✓", tone: "ok" }, { label: "Fee letter outstanding", tone: "warn" }]);
});

test("signed badge: nothing signed says what is outstanding", () => {
  const s = signedState([{ ncnda_signed: "No", fee_signed: "No" }]);
  assert.equal(s.state, "unsigned");
  assert.equal(s.badge, "Not signed yet");
  assert.deepEqual(s.chips.map((c) => c.label), ["NCNDA outstanding", "Fee letter outstanding"]);
});

test("signed badge: no linked deal, and blanks", () => {
  assert.deepEqual(signedState([]), { state: "none", badge: null, chips: [] });
  const s = signedState([{ ncnda_signed: null, fee_signed: null }]);
  assert.equal(s.state, "unsigned");
  assert.deepEqual(s.chips, []);
});

test("signed badge: any linked deal with a Yes counts", () => {
  const s = signedState([{ ncnda_signed: "No", fee_signed: "No" }, { ncnda_signed: "Yes", fee_signed: "Yes" }]);
  assert.deepEqual(s.chips.map((c) => c.label), ["Fee protected ✓", "NCNDA ✓"]);
});

test("deal next step: earliest dated, overdue in UK days", () => {
  const n = dealNext([{ next_step: "Later", next_date: "2026-11-10" }, { next_step: "  Chase   the fee letter ", next_date: "2026-10-20" }], "2026-10-26");
  assert.deepEqual(n, { text: "Chase the fee letter", date: "2026-10-20", overdue: true });
  assert.equal(dealNext([{ next_step: "Today", next_date: "2026-10-26" }], "2026-10-26")?.overdue, false);
  assert.equal(dealNext([{ next_step: null, next_date: null }]), null);
  assert.equal(dealNext([]), null);
});

// ---------- grouping ----------

const P = (rank: number, title: string, deal_ids: string[] = [], target_lines: string[] = []) => ({ id: `p${rank}`, rank, title, deal_ids, target_lines });

test("grouping: the two Al-Risha priorities on one deal become one mandate", () => {
  const ps = [
    P(4, "SE Wisconsin brownfield site (Project A)", ["dw"], ["Capital-Provide", "Land-Buy"]),
    P(2, "Al-Risha phase 1 (Mindstream): ~$100m convertible investors", ["da"], ["Capital-Provide"]),
    P(3, "DIGGERS 100 MW: equipment quotes and suppliers", ["dd"], ["Compute-Sell"]),
    P(1, "Al-Risha phase 1 (Mindstream): find the offtaker", ["da"], ["Compute-Buy"]),
  ];
  const g = groupPriorities(ps);
  assert.deepEqual(g.map((x) => x.name), ["Al-Risha phase 1 (Mindstream)", "DIGGERS 100 MW", "SE Wisconsin brownfield site (Project A)"]);
  assert.deepEqual(g[0].members.map((m) => m.rank), [1, 2]);
  assert.deepEqual(g[0].members.map(workstreamLabel), ["Offtakers", "Investors"]);
  const { shown, hidden } = splitVisible(g, 3);
  assert.deepEqual(shown.map((x) => x.name), ["Al-Risha phase 1 (Mindstream)", "DIGGERS 100 MW"]);
  assert.deepEqual(hidden.map((x) => x.name), ["SE Wisconsin brownfield site (Project A)"]);
});

test("grouping: same title head groups without a deal; a shared deal names a group whose titles differ", () => {
  const g1 = groupPriorities([P(1, "Al-Risha: offtakers"), P(2, "Al-Risha: investors"), P(3, "Optio: find borrowers")]);
  assert.deepEqual(g1.map((x) => [x.name, x.members.length]), [["Al-Risha", 2], ["Optio", 1]]);
  const g2 = groupPriorities([P(1, "Find the offtaker", ["d1"]), P(2, "Convertible note", ["d1"])], (id) => (id === "d1" ? "Al-Risha phase 1: introductions" : null));
  assert.equal(g2.length, 1);
  assert.equal(g2[0].name, "Al-Risha phase 1");
  assert.equal(titleHead("No colon here"), "No colon here");
});

test("workstream labels and the supplier network heading", () => {
  assert.equal(workstreamLabel({ title: "X: find borrowers", target_lines: ["Capital-Raise"] }), "Borrowers");
  assert.equal(workstreamLabel({ title: "Y", target_lines: ["Capital-Provide", "Land-Buy"] }), "Investors and site buyers");
  assert.equal(workstreamLabel({ title: "Z: find the offtaker", target_lines: [] }), "Find the offtaker");
  assert.equal(isSupplyPriority({ target_lines: ["Compute-Sell"] }), true);
  assert.equal(networkHeading({ target_lines: ["Compute-Sell"] }), "Suppliers and integrators in your network");
  assert.equal(networkHeading({ target_lines: ["Capital-Provide"] }), "Best in your network");
  assert.equal(scoreWidth(104), 100);
  assert.equal(scoreWidth(57.6), 58);
  assert.equal(scoreWidth(null), 0);
});

// ---------- prompts ----------

test("batch draft prompt lists every person with their contact id", () => {
  const people = [
    { contact_id: "c1", name: "Leila Nasser", title: "Head of Capacity", company: "Desert Peak Cloud" },
    { contact_id: "c2", name: "Sam Example", title: null, company: "Example Fund." },
    { contact_id: "c3", name: null, title: "CTO", company: null },
  ];
  assert.equal(
    batchDraftPrompt(people, { rank: 1, title: "Al-Risha phase 1: find the offtaker" }),
    "Nodus command (priority 1: Al-Risha phase 1: find the offtaker). Draft one first message each, for my approval, to these 3 people from my CRM. " +
      "Use each person's CRM record (contact_id) and the nodus-command playbook; blind brief only, no client names; tag every draft to this priority and put them in my console Review.\n" +
      "1. Leila Nasser, Head of Capacity, Desert Peak Cloud (contact_id c1)\n" +
      "2. Sam Example, Example Fund (contact_id c2)\n" +
      "3. Unnamed contact, CTO (contact_id c3)",
  );
  assert.match(batchDraftPrompt(people.slice(0, 1), { rank: 2, title: "Investors" }), /^Nodus command \(priority 2: Investors\)\. Draft one first message each, for my approval, to this person from my CRM\./);
});

test("Not now: dismissal rows, expiry and filtering", () => {
  assert.equal(addDays("2026-10-26", 60), "2026-12-25");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.deepEqual(dismissalRows("p1", ["a", "b", "a"], null, "2026-10-26"), [
    { priority_id: "p1", contact_id: "a", reason: null, until: "2026-12-25" },
    { priority_id: "p1", contact_id: "b", reason: null, until: "2026-12-25" },
  ]);
  assert.equal(dismissalRows("p1", ["a"], "Not a fit", "2026-10-26")[0].reason, "Not a fit");
  assert.equal(isActiveDismissal({ until: null }, "2026-10-26"), true);
  assert.equal(isActiveDismissal({ until: "2026-10-26" }, "2026-10-26"), true);
  assert.equal(isActiveDismissal({ until: "2026-10-25" }, "2026-10-26"), false);
  const ds = [
    { priority_id: "p1", contact_id: "a", until: "2026-12-25" },
    { priority_id: "p1", contact_id: "b", until: "2026-10-01" }, // expired: back on the list
    { priority_id: "p2", contact_id: "c", until: null }, // another priority
  ];
  assert.deepEqual([...dismissedIds(ds, "p1", "2026-10-26")], ["a"]);
  const rows = ["a", "b", "c", "d", "e"].map((contact_id) => ({ contact_id }));
  assert.deepEqual(withoutDismissed(rows, ds, "p1", 15, "2026-10-26").map((r) => r.contact_id), ["b", "c", "d", "e"]);
  assert.deepEqual(withoutDismissed(rows, ds, "p1", 2, "2026-10-26").map((r) => r.contact_id), ["b", "c"]);
  assert.deepEqual(withoutDismissed(rows, ds, "p2", 15, "2026-10-26").map((r) => r.contact_id), ["a", "b", "d", "e"]);
});

test("get quotes prompt for the supplier priority", () => {
  assert.equal(
    quotesPrompt({ rank: 3, title: "DIGGERS 100 MW: equipment quotes and suppliers" }),
    "Nodus command (priority 3: DIGGERS): prepare an anonymised RFQ for the 100 MW BOM (no DIGGERS name or project details) to the best 5 integrators/suppliers in my network and new ones; draft for my approval.",
  );
  assert.match(quotesPrompt({ rank: 5, title: "Quartz equipment" }), /^Nodus command \(priority 5: Quartz\): prepare an anonymised RFQ for the BOM \(no Quartz name/);
});

test("Enrich & draft prompt, for one opportunity and for both sides of a match", () => {
  assert.equal(
    enrichPrompt([{ id: "1a2b3c4d-0000-4000-8000-000000000000", title: "40 MW site, Ohio" }]),
    "Nodus command: enrich opportunity NOD-1A2B3C4D (40 MW site, Ohio) with decision makers (Apollo, work emails only) and draft first touches tied to my top priority that fits; put drafts in my console.",
  );
  assert.match(
    enrichPrompt([{ id: "aaaaaaaa-0", title: "Supply" }, { id: "bbbbbbbb-0", title: null }]),
    /^Nodus command: enrich opportunities NOD-AAAAAAAA \(Supply\) and NOD-BBBBBBBB with decision makers/,
  );
});

// ---------- parked ----------

test("parked drafts are filtered out and never part of the deck", () => {
  const rows = [{ id: "a", status: "draft" }, { id: "b", status: "parked" }, { id: "c", status: "manual" }];
  assert.deepEqual(withoutParked(rows).map((r) => r.id), ["a", "c"]);
  assert.equal(isParked({ status: "parked" }), true);
  assert.equal(isParked({ status: "draft" }), false);
  assert.ok(!(DECK_STATUSES as readonly string[]).includes("parked"));
});
