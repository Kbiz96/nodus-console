import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOKING_URL, linkifySignature, toHtml } from "../supabase/functions/nodus-apollo/html.ts";

const SIG = "Kuran Sailopal\nDirector, Nodus Partners\nkuran@nodus.partners | +44 7501 980345\nnodus.partners | Book a meeting";

test("the signature's address, domain and Book a meeting become links", () => {
  const html = toHtml(`Hi Jo,\n\nShort note about nodus.partners and kuran@nodus.partners.\n\nKind regards,\n\n${SIG}`);
  assert.equal(
    html,
    "<p>Hi Jo,</p><p>Short note about nodus.partners and kuran@nodus.partners.</p><p>Kind regards,</p>" +
      "<p>Kuran Sailopal<br>Director, Nodus Partners<br><a href=\"mailto:kuran@nodus.partners\">kuran@nodus.partners</a> | +44 7501 980345<br>" +
      `<a href="https://nodus.partners">nodus.partners</a> | <a href="${BOOKING_URL}">Book a meeting</a></p>`,
  );
});

test("RFQ signatures link info@nodus.equipment and nodus.equipment", () => {
  const out = linkifySignature("Kuran Sailopal\ninfo@nodus.equipment\nnodus.equipment | Book a meeting");
  assert.ok(out.includes('<a href="mailto:info@nodus.equipment">info@nodus.equipment</a>'));
  assert.ok(out.includes('<a href="https://nodus.equipment">nodus.equipment</a>'));
  assert.ok(out.includes(`<a href="${BOOKING_URL}">Book a meeting</a>`));
});

test("a raw calendar URL becomes the Book a meeting link", () => {
  const out = linkifySignature("Kuran Sailopal\nnodus.partners | https://calendar.app.google/UM14qXc4ZQqxewFYA");
  assert.equal(out, `Kuran Sailopal\n<a href="https://nodus.partners">nodus.partners</a> | <a href="${BOOKING_URL}">Book a meeting</a>`);
  const both = linkifySignature("Kuran Sailopal\nBook a meeting | https://calendar.app.google/abc");
  assert.equal(both, `Kuran Sailopal\n<a href="${BOOKING_URL}">Book a meeting</a>`);
});

test("prose is escaped, never linkified; no signature means no links", () => {
  assert.equal(toHtml("A <b> & nodus.partners\n\nThanks"), "<p>A &lt;b&gt; &amp; nodus.partners</p><p>Thanks</p>");
});
