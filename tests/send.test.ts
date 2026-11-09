import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FROM_CAPITAL, FROM_DEFAULT, addressIn, b64urlDecodeBytes, buildMessage, domainOf, fromFor, pickLane, rewriteFrom, ukMidnightIso,
} from "../supabase/functions/nodus-send/mail.ts";
import { STOP_ALL, sendFailText } from "../src/lib/send.ts";

const text = (b64: string) => new TextDecoder().decode(b64urlDecodeBytes(b64));

test("capital goes from kuran@nodus.partners, everything else from info@nodus.equipment", () => {
  assert.equal(fromFor(pickLane("400 MW AI campus, small investor group", null)), FROM_CAPITAL);
  assert.equal(fromFor(pickLane("Family office allocation into digital infrastructure", null)), FROM_CAPITAL);
  assert.equal(fromFor(pickLane("B300 capacity for UpCloud, available now", null)), FROM_DEFAULT);
  assert.equal(fromFor(pickLane("GPU financing for your next cluster", null)), FROM_DEFAULT);
  assert.equal(fromFor(pickLane("Länsi-Pennala: zoned and beside Fingrid", null)), FROM_DEFAULT);
  assert.equal(fromFor(pickLane("RFQ: 20 MW gas gensets", "capital")), FROM_DEFAULT, "equipment words win");
  assert.equal(fromFor(pickLane("Compute for the AI Materials Foundry", "capital")), FROM_CAPITAL, "the capital line wins");
  assert.equal(fromFor(pickLane("Compute for Genesis robot models", "compute")), FROM_DEFAULT);
});

test("domains", () => {
  assert.equal(domainOf("Erik@Venice.ai"), "venice.ai");
  assert.equal(domainOf("nope"), null);
});

test("rewriteFrom replaces the From line (folded too) and keeps the body", () => {
  const raw = "From: Kuran Sailopal\r\n <info@nodus.equipment>\r\nTo: a@b.com\r\nSubject: Hi\r\n\r\nBody line\r\nFrom: not a header\r\n";
  const b64 = btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const out = text(rewriteFrom(b64, FROM_CAPITAL));
  assert.match(out, /^From: Kuran Sailopal <kuran@nodus\.partners>\r\nTo: a@b\.com\r\nSubject: Hi\r\n\r\nBody line\r\nFrom: not a header/);
  assert.equal((out.match(/info@nodus\.equipment/g) ?? []).length, 0);
});

test("buildMessage: headers, reply threading, UTF-8 parts", () => {
  const out = text(buildMessage({
    from: FROM_DEFAULT, to: "x@y.com", toName: "Zoë", subject: "Re: Hello", body: "Hi Zoë,\n\nThanks.\n\nKuran Sailopal\nDirector, Nodus Partners",
    inReplyTo: "<abc@mail.gmail.com>", boundary: "B",
  }));
  assert.match(out, /^From: Kuran Sailopal <info@nodus\.equipment>\r\n/);
  assert.match(out, /To: =\?UTF-8\?B\?[^?]+\?= <x@y\.com>/);
  assert.match(out, /In-Reply-To: <abc@mail\.gmail\.com>\r\nReferences: <abc@mail\.gmail\.com>/);
  assert.match(out, /Content-Type: multipart\/alternative; boundary="B"/);
  assert.match(out, /--B\r\nContent-Type: text\/plain; charset="UTF-8"/);
  assert.match(out, /--B--/);
});

test("addressIn", () => {
  assert.equal(addressIn("Kuran Sailopal <Kuran@Nodus.partners>"), "kuran@nodus.partners");
  assert.equal(addressIn("info@nodus.equipment"), "info@nodus.equipment");
});

test("UK midnight", () => {
  assert.equal(ukMidnightIso(new Date("2026-11-09T17:00:00Z")), "2026-11-09T00:00:00.000Z");
  assert.equal(ukMidnightIso(new Date("2026-07-01T10:00:00Z")), "2026-06-30T23:00:00.000Z");
});

test("send failures read plainly and the batch stops on the right ones", () => {
  assert.match(sendFailText({ ok: false, reason: "alias_not_verified", from: FROM_CAPITAL }).text, /kuran@nodus\.partners is not a verified/);
  assert.match(sendFailText({ ok: false, reason: "daily_cap", cap: 50, sent_today: 50 }).text, /limit of 50/);
  assert.match(sendFailText({ ok: false, reason: "domain_contacted", domain: "vitol.com" }).text, /vitol\.com already had an email/);
  assert.ok(STOP_ALL.includes("gmail_not_connected") && !STOP_ALL.includes("domain_contacted"));
});
