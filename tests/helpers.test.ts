import { test } from "node:test";
import assert from "node:assert/strict";
import { exportFilename, fmtDate, fmtDateTime, fmtGBP, fmtMW, fmtNumber, nextDay, reference, safeHref, ukDayStartIso, ukMonthStart } from "../src/lib/format.ts";
import { buildCriteria, criteriaSummary, hasAnyFilter, hrefWith, isUuid, pageFrom, parseFilters } from "../src/lib/filters.ts";
import { friendlyError, gateBlocker, isNotAllowed, needsConfirmation, nextGate } from "../src/lib/rules.ts";

test("dates are shown in UK time, like 15 Oct 2026", () => {
  assert.equal(fmtDate("2026-10-15T09:00:00Z"), "15 Oct 2026");
  // 23:30 UTC in British Summer Time is already the next day in the UK
  assert.equal(fmtDate("2026-06-30T23:30:00Z"), "1 Jul 2026");
  assert.equal(fmtDateTime("2026-10-15T08:05:00Z"), "15 Oct 2026, 09:05");
  assert.equal(fmtDateTime("2026-12-01T08:05:00Z"), "1 Dec 2026, 08:05");
  assert.equal(fmtDate(null), "—");
  assert.equal(fmtDate("not a date", "Never"), "Never");
});

test("UK day boundaries follow summer time", () => {
  assert.equal(ukDayStartIso("2026-10-15"), "2026-10-14T23:00:00.000Z");
  assert.equal(ukDayStartIso("2026-12-01"), "2026-12-01T00:00:00.000Z");
  assert.equal(ukDayStartIso("2026-10-25"), "2026-10-24T23:00:00.000Z"); // clocks go back that morning
  assert.equal(ukDayStartIso("2026-10-26"), "2026-10-26T00:00:00.000Z");
  assert.equal(nextDay("2026-12-31"), "2027-01-01");
  assert.equal(ukMonthStart(new Date("2026-08-31T23:30:00Z")), "2026-09-01"); // already September in the UK
  assert.equal(ukMonthStart(new Date("2026-10-31T23:30:00Z")), "2026-10-01"); // GMT again by then
});

test("numbers, money and sizes", () => {
  assert.equal(fmtGBP(0), "£0.00");
  assert.equal(fmtGBP("12.5"), "£12.50");
  assert.equal(fmtGBP(null), "£0.00");
  assert.equal(fmtNumber(1234567), "1,234,567");
  assert.equal(fmtNumber(undefined), "—");
  assert.equal(fmtMW(250), "250 MW");
  assert.equal(fmtMW(2.25), "2.3 MW");
  assert.equal(fmtMW("40"), "40 MW");
  assert.equal(fmtMW(null), "—");
  assert.equal(fmtMW(""), "—");
});

test("only web links are clickable; references and file names", () => {
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("https://example.com/a"), "https://example.com/a");
  assert.equal(reference("1a2b3c4d-0000-0000-0000-000000000000"), "NOD-1A2B3C4D");
  assert.equal(exportFilename("abcdef12-3456", new Date("2026-10-15T12:00:00Z")), "nodus-match-abcdef12-2026-10-15.json");
});

test("filters are read safely from the address", () => {
  const f = parseFilters(new URLSearchParams("q=  ealing   data &line=compute&country=gb&mw=50&from=2026-10-01&to=2026-02-31&side=x&gate=protected&status=rejected"));
  assert.equal(f.q, "ealing data");
  assert.equal(f.line, "compute");
  assert.equal(f.country, "GB");
  assert.equal(f.minMw, 50);
  assert.equal(f.from, "2026-10-01");
  assert.equal(f.to, null); // 31 Feb is not a day
  assert.equal(f.side, null);
  assert.equal(f.gate, "protected");
  assert.equal(f.status, "rejected");
  assert.equal(parseFilters(new URLSearchParams("line=bad&mw=-3")).line, null);
  assert.equal(parseFilters(new URLSearchParams("mw=-3")).minMw, null);
  assert.equal(hasAnyFilter(parseFilters(new URLSearchParams(""))), false);
  assert.equal(hrefWith("/search", { q: "a b", line: null, mw: 5 }), "/search?q=a+b&mw=5");
  assert.equal(hrefWith("/search", {}), "/search");
  assert.equal(pageFrom(new URLSearchParams("page=3")), 3);
  assert.equal(pageFrom(new URLSearchParams("page=-1")), 1);
  assert.equal(isUuid("3f1c2a9e-1b2c-4d5e-8f90-1234567890ab"), true);
  assert.equal(isUuid("1; drop table"), false);
});

test("mandate form becomes engine criteria", () => {
  const base = { label: "Investor A", line: "capital", side: "need", targetSide: "supply", lines: [], countries: "gb, us;AE", mwMin: "", mwMax: "500", amountMin: "$1,000,000", amountMax: "", keywords: "turbine, H100, turbine", notes: " likes UK " };
  const r = buildCriteria(base);
  assert.ok("criteria" in r);
  assert.deepEqual(r.criteria, { lines: ["capital"], target_side: "supply", countries: ["GB", "US", "AE"], mw_max: 500, amount_min_usd: 1000000, keywords: ["turbine", "H100"], notes: "likes UK" });
  assert.deepEqual(buildCriteria({ ...base, countries: "Britain" }), { error: "Countries must be two-letter codes like GB, US, AE. Not understood: BRITAIN" });
  assert.deepEqual(buildCriteria({ ...base, mwMin: "600" }), { error: "Minimum MW is larger than maximum MW." });
  assert.deepEqual(buildCriteria({ ...base, label: " " }), { error: "Please give the mandate a name." });
  assert.deepEqual(buildCriteria({ ...base, mwMin: "lots" }), { error: "Sizes and amounts must be numbers (or left blank)." });
  const s = criteriaSummary({ lines: ["compute"], target_side: "supply", mw_min: 10, amount_max_usd: 5000000 }, (l) => l.toUpperCase());
  assert.deepEqual(s, ["Sees: COMPUTE", "Looking for: things on offer", "Size: 10–any MW", "Amount: $0–$5,000,000"]);
});

test("gate rules explain blockers up front", () => {
  assert.equal(nextGate("unverified"), "qualified");
  assert.equal(nextGate("introduced"), null);
  assert.equal(needsConfirmation("qualified"), false);
  assert.equal(needsConfirmation("protected"), true);
  const o = { line: "compute", side: "supply", specs: {}, gate: "unverified", orgSanctions: "clear" };
  assert.match(gateBlocker(o) ?? "", /chain of title/);
  assert.equal(gateBlocker({ ...o, specs: { chain_of_title: "invoice" } }), null);
  assert.match(gateBlocker({ ...o, gate: "verified", orgSanctions: null }) ?? "", /No organisation/);
  assert.match(gateBlocker({ ...o, gate: "verified", orgSanctions: "possible_match" }) ?? "", /not sanctions-clear/);
  assert.equal(gateBlocker({ ...o, gate: "verified" }), null);
});

test("database messages are shown as written", () => {
  assert.equal(friendlyError({ message: "Please tick the confirmation box" }), "Please tick the confirmation box");
  assert.equal(friendlyError(new Error("ERROR: Please say why (a short note)")), "Please say why (a short note)");
  assert.match(friendlyError(new TypeError("Failed to fetch")), /internet connection/);
  assert.equal(friendlyError(null), "That did not work. Please try again.");
  assert.equal(isNotAllowed({ code: "42501", message: "x" }), true);
  assert.equal(isNotAllowed({ message: "Not allowed: sign in as an approved user" }), true);
  assert.equal(isNotAllowed({ message: "Match not found" }), false);
});
