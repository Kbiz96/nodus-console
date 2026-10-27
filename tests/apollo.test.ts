import { test } from "node:test";
import assert from "node:assert/strict";
import { SETUP_NOTE, apolloFailText, draftPrompt, sequenceUrl } from "../src/lib/apollo.ts";

test("Apollo failures read as one plain line, with a link to fix an inactive sequence", () => {
  assert.equal(apolloFailText({ ok: false, reason: "missing_api_key" }).text, SETUP_NOTE);
  assert.equal(SETUP_NOTE, "Add your Apollo API key in Supabase → Edge Functions → Secrets as APOLLO_API_KEY");
  const inactive = apolloFailText({ ok: false, reason: "sequence_inactive", sequence: { key: "capital", id: "6ae0955be36fa500181c4307", name: "Capital / investors" } });
  assert.equal(inactive.text, "Activate the Capital / investors sequence in Apollo first. Nothing was sent.");
  assert.equal(inactive.link?.href, "https://app.apollo.io/#/sequences/6ae0955be36fa500181c4307");
  assert.equal(sequenceUrl("x"), "https://app.apollo.io/#/sequences/x");
  assert.match(apolloFailText({ ok: false, reason: "contact_stage", stage: "Replied" }).text, /already at Replied/);
  assert.match(apolloFailText({ ok: false, reason: "weird", message: "boom" }).text, /boom/);
});

test("Draft on a Find result asks for one first touch into the Approve deck, follow-ups in the note, nothing sent", () => {
  const p = draftPrompt({ name: "Jo Bloggs", title: "Partner", company: "Example Infra", lead_candidate_id: "L1", size_evidence: "320 employees (Apollo)", why: "Partner at Example Infra" }, null, "C36 capital ask", "relationship first; mandate range");
  assert.ok(p.startsWith("Nodus command: draft a first-touch email to Jo Bloggs, Partner, Example Infra (lead_candidates id L1), for: C36 capital ask."));
  assert.ok(p.includes("research the person and their firm"));
  assert.ok(p.includes("per OUTBOUND-PROMPT v3 using this mandate's icp.approach: relationship first; mandate range."));
  assert.ok(p.includes("Insert it into outreach as a draft"));
  assert.ok(p.includes('"FU1: ..." and "FU2: ..."') && p.endsWith("Do not send."));
  assert.ok(p.includes("never mention fees"));
});
