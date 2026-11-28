import { test } from "node:test";
import assert from "node:assert/strict";
import { type NxListing } from "../src/lib/nodusx.ts";
import { CALL_LINK, priority, rankRequests, isOpen, isRequest, optionsFor, replyKind, replyText, reqStatus, requestedRef } from "../src/lib/nodusxRequests.ts";

const base: NxListing = {
  id: "1", created_at: "2026-11-28T00:08:18Z", side: "need", kind: "gpu", mw: null, gpus: 1024, gpu_model: "B300", market: "US South Central",
  timing: "Q1 2027", note: "Re NX-29. 128 units, 5 years, to be delivered within 1 month", note_original: "Re NX-29. 128 units, 5 years, to be delivered within 1 month",
  email: "zaria@fourward.example", company: "Fourward systems, LLC", role: null, status: "pending", origin: "self", source: "nodusx", deal: null,
  spec: null, ref: null, crm_contact_id: null, diligence: null, review_note: null, reject_reason: null, info_requested: null, reviewed_at: null,
  decision_emailed_at: null, decision_email: null, agreement: null,
};
const lot = (ref: string, gpus: number, model = "B300", status: NxListing["status"] = "approved"): NxListing =>
  ({ ...base, id: ref, side: "have", ref, gpus, gpu_model: model, status, note: null, note_original: null, market: "Netherlands", timing: "Now", deal: "Rental" });

test("a website request for a lot is a request and names the lot", () => {
  assert.equal(isRequest(base), true);
  assert.equal(requestedRef(base), "NX-29");
  assert.equal(replyKind(base), "lot");
});

test("ordinary listings are not requests", () => {
  assert.equal(isRequest({ ...base, note: "32 HGX B300 nodes", note_original: "32 HGX B300 nodes" }), false);
  assert.equal(isRequest({ ...base, note: "x", note_original: "x", source: "nodusx-request" }), true);
  assert.equal(isRequest({ ...base, note: "x", note_original: "x", spec: { request_of: "NX-22" } }), true);
});

test("status defaults to new and closed ones drop out of open", () => {
  assert.equal(reqStatus(base), "new");
  assert.equal(isOpen(base), true);
  assert.equal(isOpen({ ...base, spec: { req: { status: "closed" } } }), false);
});

test("thin requests get questions, full ones get screened", () => {
  const thin = { ...base, note: "Need GPUs", note_original: "Need GPUs", market: "Unspecified", timing: null };
  assert.equal(replyKind(thin), "info");
  const full = { ...base, note: "Dedicated B300 for inference, 3-year term, 25% deposit, InfiniBand", note_original: "Dedicated B300 for inference, 3-year term, 25% deposit, InfiniBand" };
  assert.equal(replyKind(full), "screen");
});

test("options put the named lot first and skip other models and closed lines", () => {
  const live = [lot("NX-22", 512), lot("NX-29", 1024), lot("NX-25", 9720, "GB300"), lot("NX-30", 560, "B300", "rejected")];
  assert.deepEqual(optionsFor(base, live).map((l) => l.ref), ["NX-29", "NX-22"]);
});

test("every reply offers the call link and names no prices", () => {
  const live = [lot("NX-22", 512), lot("NX-29", 1024)];
  for (const k of ["lot", "info", "screen"] as const) {
    const r = replyText(base, k, live);
    assert.ok(r.body.includes(CALL_LINK), k);
    assert.doesNotMatch(r.body, /\$\s?\d/, k);
  }
  assert.match(replyText(base, "lot", live).body, /1\. NX-29/);
  assert.match(replyText(base, "lot", live).subject, /NX-29/);
});

test("ranking: open first, legitimacy counts double, unscreened last", () => {
  const r = (id: string, req: object) => ({ ...base, id, spec: { req } });
  const rows = [
    r("unscreened", {}),
    r("urgent-unverified", { legit: 1, urgency: 3, category: "referrer" }),
    r("real-slow", { legit: 3, urgency: 1, category: "supply" }),
    r("real-buyer", { legit: 3, urgency: 3, category: "direct_buyer" }),
    r("closed", { legit: 3, urgency: 3, status: "closed" }),
  ];
  assert.deepEqual(rankRequests(rows).map((x) => x.id), ["real-buyer", "real-slow", "urgent-unverified", "unscreened", "closed"]);
  assert.equal(priority(rows[0]), 0);
  assert.equal(priority(rows[3]), 10);
});
