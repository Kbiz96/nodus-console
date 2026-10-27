import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRows, markdownToHtml, searchRows, type LearningRow } from "../src/lib/learning.ts";

const row = (id: string, date: string | null, pillar: string, kind = "lesson", module = "M"): LearningRow =>
  ({ id, lesson_date: date, slot: "am", pillar, module, title: `T ${id}`, summary: null, kind });

test("markdownToHtml escapes raw HTML and keeps only https links", () => {
  const html = markdownToHtml("# Hi\n<script>x</script> **bold** [ok](https://a.b) [no](javascript:alert(1))");
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.ok(html.includes('<a href="https://a.b">ok</a>'));
  assert.ok(!html.includes('href="javascript'));
});

test("markdownToHtml renders lists and tables", () => {
  const html = markdownToHtml("- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |");
  assert.ok(html.includes("<ul><li>a</li><li>b</li></ul>"));
  assert.ok(html.includes("<th>x</th>") && html.includes("<td>2</td>"));
});

test("groupRows: newest first, undated course modules after", () => {
  const g = groupRows([row("a", "2026-10-01", "A"), row("c", null, "B", "course"), row("b", "2026-10-12", "C")], "newest");
  assert.deepEqual(g.map((x) => x.rows.map((r) => r.id)), [["b", "a"], ["c"]]);
});

test("groupRows: by pillar in A to E order", () => {
  const g = groupRows([row("d", "2026-10-01", "D"), row("a", "2026-10-02", "A"), row("e", "2026-10-03", "E")], "module");
  assert.deepEqual(g.map((x) => x.key), ["p-A", "p-D", "p-E"]);
});

test("searchRows matches every word", () => {
  const rows = [row("x", "2026-10-01", "A", "lesson", "Gas turbines"), row("y", "2026-10-01", "B")];
  assert.deepEqual(searchRows(rows, "gas turb").map((r) => r.id), ["x"]);
});
