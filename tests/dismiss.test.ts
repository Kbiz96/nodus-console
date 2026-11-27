import { test } from "node:test";
import assert from "node:assert/strict";
import { dismissKey, filterDismissed, newestDismissed, skippedReason, skipsOnDismiss, statusBeforeSkip } from "../src/lib/dismiss.ts";
import { newestFirst } from "../src/lib/deck.ts";
import { briefReplyRef, repliesOwed } from "../src/lib/today.ts";

test("filterDismissed: leaves out dismissed items of that kind only, keeps order, does not change the input", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const set = new Set([dismissKey("outreach", "b"), dismissKey("deal", "c")]);
  assert.deepEqual(filterDismissed(items, "outreach", (x) => x.id, set).map((x) => x.id), ["a", "c"]);
  assert.deepEqual(filterDismissed(items, "deal", (x) => x.id, set).map((x) => x.id), ["a", "b"]);
  assert.deepEqual(filterDismissed(items, "contact", (x) => x.id, set).map((x) => x.id), ["a", "b", "c"]);
  assert.deepEqual(filterDismissed(items, "outreach", (x) => x.id, new Set()).map((x) => x.id), ["a", "b", "c"]);
  // an item with no ref can never be dismissed
  assert.deepEqual(filterDismissed([{ id: null }], "outreach", (x) => x.id, set).length, 1);
  assert.equal(items.length, 3);
  assert.equal(dismissKey("brief_reply", "x|y"), "brief_reply:x|y");
});

test("X on an email: draft and approved are skipped (never sent); sent, replied and manual are only hidden", () => {
  assert.equal(skipsOnDismiss("draft"), true);
  assert.equal(skipsOnDismiss("approved"), true);
  for (const s of ["sent", "replied", "manual", "skipped", "parked", "", null, undefined]) assert.equal(skipsOnDismiss(s), false);
  assert.equal(skippedReason("draft"), "skipped:draft");
  assert.equal(statusBeforeSkip(skippedReason("draft")), "draft");
  assert.equal(statusBeforeSkip(skippedReason("approved")), "approved");
  assert.equal(statusBeforeSkip(null), null);
  assert.equal(statusBeforeSkip("not interested"), null);
  assert.equal(statusBeforeSkip("skipped:sent"), null, "only draft or approved ever come back");
});

test("Dismissed page: newest first", () => {
  const rows = [
    { id: "1", dismissed_at: "2026-11-25T09:00:00Z" },
    { id: "2", dismissed_at: "2026-11-27T09:00:00Z" },
    { id: "3", dismissed_at: "2026-11-26T09:00:00Z" },
  ];
  assert.deepEqual(newestDismissed(rows).map((r) => r.id), ["2", "3", "1"]);
  assert.equal(rows[0].id, "1");
});

test("emails sort newest draft first, whatever the mandate", () => {
  const rows = [
    { id: "a", created_at: "2026-11-20T08:00:00Z" },
    { id: "b", created_at: "2026-11-27T08:00:00Z" },
    { id: "c", created_at: "2026-11-24T08:00:00Z" },
    { id: "d", created_at: "2026-11-24T08:00:00Z" },
  ];
  assert.deepEqual(newestFirst(rows).map((r) => r.id), ["b", "c", "d", "a"]);
  assert.deepEqual(newestFirst([]), []);
  assert.equal(rows[0].id, "a");
});

test("replies owed carry what X records: brief replies by a stable key, logged replies by their outreach row", () => {
  assert.equal(briefReplyRef({ who: "Dana  Reed", company: "Penguin", gmail_draft_url: null }), "dana reed|penguin");
  assert.equal(briefReplyRef({ who: "Dana", company: "Penguin", gmail_draft_url: "https://mail.google.com/mail/u/0/#drafts/d1" }), "https://mail.google.com/mail/u/0/#drafts/d1");
  const owed = repliesOwed(
    [{ who: "Dana Reed", company: "Penguin", summary: "Wants two slots", gmail_draft_url: null }],
    [{ id: "o2", to_name: "Alex Example", to_email: "alex@example.com", company: "Example Power Ltd", subject: "Hi", replied_at: null }],
  );
  assert.deepEqual(owed.map((o) => o.dismiss), [{ kind: "brief_reply", ref: "dana reed|penguin" }, { kind: "outreach", ref: "o2" }]);
});
