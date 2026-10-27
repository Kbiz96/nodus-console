import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignStatuses, creditSummary, seqFromNote, summarise, type OutRow } from "../supabase/functions/nodus-apollo/activity.ts";

const SEQ = "6ae0955be36fa500181c4307";
const row = (id: string, email: string, extra: Partial<OutRow> = {}): OutRow => ({
  id, to_email: email, to_name: id, company: "Co", contact_id: `c-${id}`, status: "sent", sent_at: "2026-10-27T09:00:00Z", replied_at: null,
  note: `research | apollo:${SEQ} | from:kuran@nodus.partners`, priority_id: null, ...extra,
});

test("seqFromNote reads the sequence the send wrote", () => {
  assert.equal(seqFromNote(`x | apollo:${SEQ} | from:y`), SEQ);
  assert.equal(seqFromNote("no sequence"), null);
});

test("summarise: replied first, then bounced, then in sequence; opens counted; status from the contact", () => {
  const rows = [row("a", "a@x.com"), row("b", "B@x.com"), row("c", "c@x.com")];
  const msgs = [
    { id: "m1", to_email: "a@x.com", emailer_campaign_id: SEQ, contact_id: "ap-a", status: "completed", completed_at: "t", replied: false },
    { id: "m2", to_email: "a@x.com", emailer_campaign_id: SEQ, contact_id: "ap-a", status: "scheduled" },
    { id: "m3", to_email: "b@x.com", emailer_campaign_id: SEQ, contact_id: "ap-b", status: "completed", completed_at: "t", bounce: true },
    { id: "m4", to_email: "c@x.com", emailer_campaign_id: SEQ, contact_id: "ap-c", status: "completed", completed_at: "t", replied: true, reply_class: "willing_to_meet" },
    { id: "m5", to_email: "c@x.com", emailer_campaign_id: "other", contact_id: "ap-c", status: "completed", replied: false },
  ];
  const statuses = new Map([["ap-a", new Map([[SEQ, "paused" as const]])]]);
  const out = summarise(rows, msgs, new Set(["m1", "m4"]), statuses);
  assert.deepEqual(out.map((r) => [r.outreach_id, r.lane]), [["c", "replied"], ["b", "bounced"], ["a", "in_sequence"]]);
  assert.equal(out[0].reply_class, "willing_to_meet");
  assert.equal(out[0].sent, 1, "messages in other sequences are left out");
  assert.equal(out[2].sequence_status, "paused");
  assert.equal(out[2].opens, 1);
  assert.equal(out[1].sequence_status, "finished");
});

test("campaignStatuses and creditSummary read Apollo's shapes", () => {
  const m = campaignStatuses({ contact_campaign_statuses: [{ emailer_campaign_id: SEQ, status: "active" }, { emailer_campaign_id: "x", status: "weird" }] });
  assert.equal(m.get(SEQ), "active");
  assert.equal(m.get("x"), "unknown");
  assert.deepEqual(creditSummary({ credit_usage_stats: { lead_credit: { limit: 1000, consumed: 120, left_over: 880 } }, current_credit_cycle: { end_date: "2026-11-15" } }),
    { left: 880, limit: 1000, consumed: 120, cycle_end: "2026-11-15" });
  assert.equal(creditSummary({}).left, null);
});
