import { test } from "node:test";
import assert from "node:assert/strict";
import { decisionEmail, firstName, forbiddenWords, publicNoteWarnings, summarise, type NxListing } from "../src/lib/nodusx.ts";

const base: NxListing = {
  id: "00000000-0000-0000-0000-000000000001", created_at: "2026-11-19T10:00:00Z", side: "have", kind: "gpu", mw: null, gpus: 256,
  gpu_model: "B300", market: "Texas, US", timing: "February 2027", note: "32 HGX B300 nodes", note_original: "32 HGX B300 nodes",
  email: "jane.doe@acmecloud.com", company: "Acme Cloud", role: "Operator", status: "pending", origin: "self", source: "nodusx", deal: "Rental",
  spec: { nodes: "32", price: "5.25", price_unit: "per GPU-hour" }, ref: null, crm_contact_id: null, diligence: {}, review_note: null,
  reject_reason: null, info_requested: null, reviewed_at: null, decision_emailed_at: null, decision_email: null,
  agreement: { id: "a", created_at: "2026-11-19T10:00:00Z", role: "operator", terms_version: "1.2", full_name: "jane doe", job_title: "CEO", company: "Acme Cloud", email: "jane.doe@acmecloud.com", ip: null, signature_image: null },
};

test("summary reads size, place and timing", () => {
  assert.equal(summarise(base), "Supply rental: 32 nodes, 256 B300 · Texas, US · February 2027");
  assert.equal(summarise({ ...base, kind: "capacity", gpus: null, mw: 2.4, side: "need", deal: "Colocation", spec: null }), "Requirement colocation: 2,400 kW · Texas, US · February 2027");
});

test("first name comes from the signature, else the mailbox", () => {
  assert.equal(firstName(base), "Jane");
  assert.equal(firstName({ ...base, agreement: null }), "Jane");
  assert.equal(firstName({ ...base, agreement: null, email: "info@acme.com" }), "Hello");
});

test("decision emails never carry fees or prices", () => {
  for (const d of ["approve", "info", "reject", "withdraw"] as const) {
    const e = decisionEmail(base, d, { ref: "NX-13", reason: "no confirmed RFS date", info: "- RFS date" });
    assert.ok(e, d);
    assert.deepEqual(forbiddenWords(`${e!.subject}\n${e!.body}`), [], d);
    assert.match(e!.body, /Kuran Sailopal/);
  }
  assert.match(decisionEmail(base, "approve", { ref: "NX-13" })!.subject, /NX-13/);
  assert.match(decisionEmail(base, "reject", { reason: "no confirmed RFS date." })!.body, /at present: no confirmed RFS date\./);
});

test("forbidden words are caught", () => {
  assert.deepEqual(forbiddenWords("Our fee is 2%"), ["fee"]);
  assert.ok(forbiddenWords("at $5.25 per GPU-hour").length >= 2);
});

test("public wording that names the party is flagged", () => {
  assert.equal(publicNoteWarnings("32 HGX B300 nodes, RFS Feb 2027", base).length, 0);
  assert.ok(publicNoteWarnings("Acme Cloud has 32 nodes", base).length > 0);
  assert.ok(publicNoteWarnings("Email jane@x.com", base).length > 0);
  assert.ok(publicNoteWarnings("Nodes at acmecloud site", base).length > 0);
});
