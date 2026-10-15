import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVCard, creditsToApprove, crmText, isOpenRequest, summariseSpend, vcfFilename, type CrmDetails } from "../src/lib/enrich.ts";

const d: CrmDetails = {
  name: "Jane Smith",
  role: "Head of Energy, UK; Ireland",
  organisation: "Ealing Power Holdings Limited",
  email: "jane.smith@example.com",
  email_status: "catch_all",
  phone: "+44 20 7946 0000",
  linkedin: "https://www.linkedin.com/in/janesmith",
  source: "apollo",
  retrieved_at: "2026-10-14T23:30:00Z",
  lawful_basis: "Legitimate interests (B2B)",
  opportunity: "NOD-11111111",
};

test("CRM details become tidy text to paste, in UK dates, leaving out blanks", () => {
  assert.equal(
    crmText(d),
    [
      "Name: Jane Smith",
      "Role: Head of Energy, UK; Ireland",
      "Organisation: Ealing Power Holdings Limited",
      "Email: jane.smith@example.com (Catch-all: may not reach)",
      "Phone: +44 20 7946 0000",
      "LinkedIn: https://www.linkedin.com/in/janesmith",
      "Source: Apollo, retrieved 15 Oct 2026",
      "Lawful basis: Legitimate interests (B2B)",
      "Nodus reference: NOD-11111111",
    ].join("\n"),
  );
  assert.equal(crmText({ ...d, email: null, phone: "", linkedin: null, source: "vibe", retrieved_at: null }).includes("Email"), false);
  assert.match(crmText({ ...d, source: "vibe", retrieved_at: null }), /Source: Vibe Prospecting$/m);
});

test("contact card (.vcf) is valid vCard 3.0 with escaping and folding", () => {
  const v = buildVCard(d);
  const lines = v.split("\r\n");
  assert.equal(lines[0], "BEGIN:VCARD");
  assert.equal(lines[1], "VERSION:3.0");
  assert.ok(v.endsWith("END:VCARD\r\n"));
  assert.ok(lines.includes("N:Smith;Jane;;;"));
  assert.ok(lines.includes("FN:Jane Smith"));
  assert.ok(lines.includes("TITLE:Head of Energy\\, UK\\; Ireland"));
  assert.ok(lines.includes("EMAIL;TYPE=INTERNET,WORK:jane.smith@example.com"));
  assert.ok(lines.includes("TEL;TYPE=WORK,VOICE:+44 20 7946 0000"));
  assert.ok(lines.includes("URL:https://www.linkedin.com/in/janesmith"));
  assert.ok(lines.every((l) => l.length <= 75), "lines are folded at 75 characters");
  const unfolded = v.replace(/\r\n /g, "");
  assert.match(unfolded, /NOTE:Source: Apollo\\, retrieved 15 Oct 2026\\nLawful basis: Legitimate interests \(B2B\)\\nEmail status: Catch-all: may not reach\\nNodus reference: NOD-11111111/);
  const bare = buildVCard({ ...d, name: "Cher", role: null, email: null, phone: null, linkedin: null, organisation: null, source: null, lawful_basis: null, opportunity: null });
  assert.equal(bare, "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Cher;;;;\r\nFN:Cher\r\nEND:VCARD\r\n");
  assert.equal(vcfFilename("Zoë O'Brien-Smith"), "zoe-o-brien-smith.vcf");
  assert.equal(vcfFilename(null), "contact.vcf");
});

test("enrichment requests and approvals", () => {
  assert.equal(isOpenRequest("pending"), true);
  assert.equal(isOpenRequest("needs_approval"), true);
  assert.equal(isOpenRequest("done"), false);
  assert.equal(isOpenRequest(undefined), false);
  assert.equal(creditsToApprove(30, 4), 30);
  assert.equal(creditsToApprove(null, 4), 4);
  assert.equal(creditsToApprove(0, 4), 4);
  assert.equal(creditsToApprove(500, 4), 200);
  assert.equal(creditsToApprove(2.4, 4), 2);
});

test("spend is totalled by provider and by opportunity", () => {
  const s = summariseSpend([
    { at: "2026-10-02T09:00:00Z", provider: "apollo", credits: "3", opportunity_id: "a" },
    { at: "2026-10-05T09:00:00Z", provider: "apollo", credits: 2, opportunity_id: "b" },
    { at: "2026-10-03T09:00:00Z", provider: "clay", credits: "1.5", opportunity_id: "a" },
    { at: "2026-10-04T09:00:00Z", provider: "vibe", credits: 1, opportunity_id: null },
  ]);
  assert.equal(s.total, 7.5);
  assert.deepEqual(s.byProvider, [
    { provider: "apollo", credits: 5, actions: 2 },
    { provider: "clay", credits: 1.5, actions: 1 },
    { provider: "vibe", credits: 1, actions: 1 },
  ]);
  assert.deepEqual(s.byOpportunity, [
    { opportunityId: "a", credits: 4.5, last: "2026-10-03T09:00:00Z" },
    { opportunityId: "b", credits: 2, last: "2026-10-05T09:00:00Z" },
    { opportunityId: null, credits: 1, last: "2026-10-04T09:00:00Z" },
  ]);
  assert.deepEqual(summariseSpend([]), { total: 0, byProvider: [], byOpportunity: [] });
});
