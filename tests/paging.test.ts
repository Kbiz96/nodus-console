import { test } from "node:test";
import assert from "node:assert/strict";
import { ilikeOr } from "../src/lib/paging.ts";
import { CACHE_TTL_MS, isFresh } from "../src/lib/cache.ts";

test("ilikeOr: one word over several columns", () => {
  assert.equal(ilikeOr("jo", ["name", "company"]), "name.ilike.*jo*,company.ilike.*jo*");
});

test("ilikeOr: every word must match somewhere", () => {
  assert.equal(ilikeOr("jo infra", ["name", "company"]), "and(or(name.ilike.*jo*,company.ilike.*jo*),or(name.ilike.*infra*,company.ilike.*infra*))");
});

test("ilikeOr: PostgREST syntax characters are stripped; empty search is null", () => {
  assert.equal(ilikeOr("a,b(c)", ["name"]), "and(or(name.ilike.*a*),or(name.ilike.*b*),or(name.ilike.*c*))");
  assert.equal(ilikeOr("  ,() ", ["name"]), null);
});

test("cache: ten minutes fresh, then stale", () => {
  const now = 1_000_000_000;
  assert.equal(isFresh(now - CACHE_TTL_MS + 1, now), true);
  assert.equal(isFresh(now - CACHE_TTL_MS, now), false);
});
