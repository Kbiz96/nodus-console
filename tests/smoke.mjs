// Browser smoke test: serves dist/ like GitHub Pages (under /nodus-console/), answers every call to
// Supabase with fixture JSON shaped like the real tables and functions, and checks the main pages render.
// Needs Playwright with Chromium already installed. Usage: npm run build && npm run smoke [-- <screenshot dir>]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { bdLeads, bdOpps, bdQueue, dailyBrief, focusData, leadCandidates, networkFor, synthetic } from "./fixtures/synthetic.mjs";
import { sequencerData } from "./fixtures/sequencer.mjs";
import { sequencerFlow } from "./sequencer-smoke.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../dist");
const shots = process.argv[2] || process.env.SHOTS_DIR || path.resolve(here, "../.smoke");
// Focus, Review and Priorities screenshots can go to their own folder.
const focusShots = process.env.FOCUS_SHOTS || shots;
// The batch-draft screenshots (selection bar visible) can go to their own folder too.
const batchShots = process.env.BATCH_SHOTS || focusShots;
const fx = JSON.parse(fs.readFileSync(path.join(here, "fixtures/fixtures.json"), "utf8"));
fx.tables.lead_candidates = [...leadCandidates(), ...bdLeads()];
const ukDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
fx.tables.daily_briefs = [dailyBrief(ukDay)];
fx.tables.bd_queue = bdQueue();
fx.bdOpps = bdOpps();
// The front page's full screenshots (desktop and phone) can go to their own folder.
const frontShots = process.env.FRONT_SHOTS || process.env.FOCUS_SHOTS || process.argv[2] || process.env.SHOTS_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.smoke");
// New-leads screenshots (Focus with the New leads tab) can go to their own folder.
const leadShots = process.env.LEADS_SHOTS || process.env.FOCUS_SHOTS || process.argv[2] || process.env.SHOTS_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.smoke");
process.env.PLAYWRIGHT_BROWSERS_PATH ||= "/opt/pw-browsers";

const require = createRequire(import.meta.url);
let chromium;
for (const p of ["playwright", "/opt/node-tools/node_modules/playwright"]) {
  try { ({ chromium } = require(p)); break; } catch { /* try next */ }
}
if (!chromium) throw new Error("Playwright is not available");

// ---- static server for dist/ under /nodus-console/ ----
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".txt": "text/plain", ".woff2": "font/woff2", ".woff": "font/woff" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (!u.pathname.startsWith("/nodus-console/")) { res.writeHead(404); return res.end(); }
  let p = u.pathname.slice("/nodus-console/".length) || "index.html";
  const file = path.join(dist, path.normalize(p));
  if (!file.startsWith(dist) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/nodus-console/`;

// ---- fake Supabase ----
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const user = { id: "0b0b0b0b-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "kuran@nodus.partners", app_metadata: {}, user_metadata: {}, created_at: "2026-09-01T00:00:00Z" };
const token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", exp })}.c2ln`;
const session = { access_token: token, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "refresh-fixture", user };

const rpcCalls = [];
const writes = [];
function fake(approved, data = fx) {
  return async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (status, body, headers = {}) =>
      route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range", ...headers }, body: body === undefined ? "" : JSON.stringify(body) });
    if (req.method() === "OPTIONS") {
      return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    }
    if (u.pathname === "/auth/v1/token") {
      const b = req.postDataJSON?.() ?? {};
      return b.password === "right-password" ? json(200, session) : json(400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials", code: "invalid_credentials" });
    }
    if (u.pathname === "/auth/v1/user") return json(200, user);
    if (u.pathname === "/auth/v1/logout") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    const m = u.pathname.match(/^\/rest\/v1\/(rpc\/)?([a-z_]+)$/);
    if (!m) return json(404, { message: "not mocked" });
    if (m[1]) {
      const name = m[2];
      const body = req.postDataJSON?.() ?? {};
      rpcCalls.push({ name, body });
      if (!approved && name !== "nodus_is_kuran") return json(403, { code: "42501", message: "Not allowed: sign in as an approved user" });
      if (name === "nodus_is_kuran") return json(200, approved);
      if (name === "search_all") return json(200, fx.search_all);
      if (name === "match_decide") return json(204);
      if (name === "match_reject") return body.p_reason ? json(204) : json(400, { code: "P0001", message: "Please pick a reason for rejecting" });
      if (name === "scoreboard") return json(200, { mandates_new: 2, matches_accepted: 3, drafts_approved: 5, emails_sent: 4, replies: 1, meetings: 1, ncndas_signed: 0, fees_signed: 0, tracking_since: "2026-10-23T12:00:00Z" });
      if (name === "match_export") return json(200, { source: "Nodus Origination Engine", anonymised: true });
      if (name === "gate_advance") return body.p_confirmed ? json(200, "protected") : json(400, { code: "P0001", message: "Please tick the confirmation box" });
      if (name === "mandate_save") return json(200, "dddddddd-0000-4000-8000-000000000001");
      if (name === "enrich_request") {
        const ids = body.p_match ? ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"] : [body.p_opp];
        return json(200, ids.map((id) => id === "22222222-2222-4222-8222-222222222222"
          ? { opportunity: id, ok: false, why: "Still Unverified. Qualify it first: enrichment never runs on unverified items." }
          : { opportunity: id, ok: true, request: "66666666-0000-4000-8000-000000000003", why: "Queued. People appear here after the next enrichment run." }));
      }
      if (name === "enrich_approve") return json(204);
      if (name === "outreach_decide") return json(204);
      if (name === "priority_network") return json(200, networkFor(body.p_priority, body.p_limit ?? 15));
      if (name === "crm_import") return json(200, { contacts: 1, deals: 1, actions: 0, outreach: 2, mandates: 1 });
      if (name === "person_crm_mark") {
        return json(200, { name: "Jane Smith", role: "Head of Disposals", organisation: "Ealing Power Holdings Limited", email: "jane.smith@example.com", email_status: "verified", phone: "+44 20 7946 0000", linkedin: "https://www.linkedin.com/in/janesmith-example", source: "apollo", retrieved_at: "2026-10-14T06:00:00Z", lawful_basis: "Legitimate interests (B2B)", opportunity: "NOD-11111111" });
      }
      return json(404, { message: "rpc not mocked" });
    }
    let table = m[2];
    if (!approved) return json(200, [], { "content-range": "*/0" });
    if (table === "audit_log" && u.searchParams.get("action") === "eq.gate_change") table = "gate_history";
    let rows = data.tables[table] ?? [];
    const idEq = u.searchParams.get("id");
    if (table === "opportunities" && idEq?.startsWith("in.(")) rows = [...rows, ...(data.bdOpps ?? [])];
    if (idEq?.startsWith("eq.")) rows = rows.filter((r) => r.id === idEq.slice(3));
    if (idEq?.startsWith("in.(")) { const set = idEq.slice(4, -1).split(",").map((x) => x.replace(/"/g, "")); rows = rows.filter((r) => set.includes(r.id)); }
    const lineEq = u.searchParams.get("line");
    if (lineEq?.startsWith("eq.")) rows = rows.filter((r) => r.line === lineEq.slice(3));
    // An approved LinkedIn draft becomes "manual" in the real database; the fixture rows do not change, so a
    // status-guarded update on outreach matches by id alone.
    const statusEq = req.method() === "PATCH" && table === "outreach" ? null : u.searchParams.get("status");
    if (statusEq?.startsWith("eq.")) rows = rows.filter((r) => r.status === statusEq.slice(3));
    if (statusEq?.startsWith("in.(")) { const set = statusEq.slice(4, -1).split(","); rows = rows.filter((r) => !r.status || set.includes(r.status)); }
    const prioEq = u.searchParams.get("priority_id");
    if (prioEq?.startsWith("eq.")) rows = rows.filter((r) => r.priority_id === prioEq.slice(3));
    if (prioEq === "is.null") rows = rows.filter((r) => r.priority_id === null);
    if (prioEq === "not.is.null") rows = rows.filter((r) => r.priority_id !== null && r.priority_id !== undefined);
    for (const col of ["tier", "day"]) {
      const v = u.searchParams.get(col);
      if (v?.startsWith("eq.")) rows = rows.filter((r) => String(r[col]) === v.slice(3));
    }
    if (prioEq?.startsWith("in.(")) { const set = prioEq.slice(4, -1).split(",").map((x) => x.replace(/"/g, "")); rows = rows.filter((r) => set.includes(r.priority_id)); }
    if (req.method() === "DELETE") { writes.push({ table, method: "DELETE", url: u.search, body: {} }); return json(200, rows.slice(0, 1)); }
    if (req.method() === "PATCH") { writes.push({ table, method: "PATCH", url: u.search, body: req.postDataJSON?.() ?? {} }); return json(200, rows.slice(0, 1)); }
    if (req.method() === "POST") {
      const body = req.postDataJSON?.() ?? {};
      writes.push({ table, method: "POST", url: u.search, body });
      return json(201, [{ id: "abababab-0000-4000-8000-0000000000ff", ...body }]);
    }
    const prefer = req.headers()["prefer"] ?? "";
    const n = data.counts[table] ?? rows.length;
    const lim = Number(u.searchParams.get("limit"));
    const off = Number(u.searchParams.get("offset")) || 0;
    if (lim > 0 || off > 0) rows = rows.slice(off, lim > 0 ? off + lim : undefined);
    const headers = prefer.includes("count=") ? { "content-range": rows.length ? `0-${rows.length - 1}/${n}` : `*/${n}` } : {};
    if (req.method() === "HEAD") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range", ...headers } });
    const accept = req.headers()["accept"] ?? "";
    if (accept.includes("vnd.pgrst.object")) return rows.length ? json(200, rows[0], headers) : json(406, { code: "PGRST116", message: "no rows" });
    return json(200, rows, headers);
  };
}

const failures = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures.push(what); };
fs.mkdirSync(shots, { recursive: true });

const P1 = "abababab-0000-4000-8000-000000000001";

/** Today, the front page: focus session, replies owed, the approve deck, LinkedIn, signed mandates as rows. */
async function todayFlow(page, label, at, newRpc, newWrites) {
  await page.goto(base);
  await page.getByRole("heading", { name: "Focus session" }).waitFor();
  check(/Good (morning|afternoon|evening), Kuran\.$/.test((await page.locator(".home-dateline").textContent()) ?? ""), at("Today greets Kuran"));
  await page.locator(".home-headline:not(.is-quiet)").waitFor();
  check((await page.locator(".home-headline").textContent()) === "Al-Risha offtaker LOI is the week’s swing. Two neocloud calls today decide it.", at("Today opens with the brief's headline"));
  check((await page.locator(".sendline").textContent()) === "Sending is paused. Approved emails wait until Kuran turns sending on (ask Claude: 'turn sending on').", at("send_enabled false: the sending line says paused"));
  check(await page.getByText(/go out at 09:53/).count() === 0, at("nothing on Today claims a send time while sending is paused"));
  // ---- Focus session: the brief's three items, one button each ----
  await page.locator(".do-row").nth(2).waitFor();
  const doTexts = await page.locator(".do-row .do-text").allTextContents();
  check(JSON.stringify(doTexts) === JSON.stringify(["Send the Al-Risha teaser to the three warmest neoclouds", "Chase the Basalt fee letter before Thursday", "Confirm the 14:00 agenda with Brightwater"]), at("the focus session is the brief's three items, in order"));
  const r1 = page.locator(".do-row").first();
  check(await r1.getByRole("link", { name: "Open draft in Gmail" }).getAttribute("href") === "https://mail.google.com/mail/u/0/#drafts?compose=fixture-teaser" && await r1.locator(".btn.primary").count() === 1, at("a Gmail link opens the draft in Gmail, as the one primary action"));
  check(await r1.getByRole("link", { name: "Open draft in Gmail" }).getAttribute("target") === "_blank", at("Gmail opens in a new tab"));
  check(await page.locator(".do-row").nth(1).locator(".do-go").count() === 0, at("an item with no link has no button of its own"));
  check(await page.locator(".do-row").nth(2).getByRole("link", { name: "Open" }).getAttribute("href") === "https://example.com/brightwater-agenda", at("an outside link opens"));
  const claudeLinks = page.locator('a[href^="https://claude.ai/new"]');
  check(await claudeLinks.count() === 1, at("Today has exactly one Claude hand-off"));
  const sq = new URL((await claudeLinks.first().getAttribute("href")) ?? "https://x");
  check((await claudeLinks.first().textContent())?.includes("Hand the unlinked item to Claude") && sq.searchParams.get("project") === "01a0f3c4-b60e-7236-8dea-4bd5402220f3" && (sq.searchParams.get("q") ?? "").startsWith("Nodus command: focus session. Do these one for me in order") && (sq.searchParams.get("q") ?? "").includes("\n1. Chase the Basalt fee letter before Thursday"), at("the one hand-off covers the unlinked item in the Nodus project"));
  await page.getByRole("button", { name: "Done: Chase the Basalt fee letter before Thursday" }).click();
  check(await page.locator(".do-row.is-done").count() === 1 && await claudeLinks.count() === 0, at("ticking the unlinked item off removes the hand-off"));
  await page.getByRole("button", { name: "Not done: Chase the Basalt fee letter before Thursday" }).click();
  check(await page.locator(".do-row.is-done").count() === 0 && await claudeLinks.count() === 1, at("and un-ticking brings it back"));
  check((await page.locator(".calls li").count()) === 2 && (await page.locator(".calls li").first().textContent())?.startsWith("10:30Harlow Compute (CEO)"), at("Calls today lists time, who and goal"));
  await page.locator(".could summary").click();
  check(JSON.stringify(await page.locator(".could li").allTextContents()) === JSON.stringify(["Comment on two GTC Berlin posts from capital allocators", "Tidy the Optio borrower list"]), at("Could do holds the brief's ideas"));
  await page.locator(".brief-more summary").click();
  check(await page.locator(".digest-list li").count() === 4, at("the digest shows at most four lines, folded"));
  await page.locator(".rep").getByRole("button", { name: "Show answer" }).click();
  check((await page.locator(".rep-a").textContent())?.startsWith("The seller’s revenue"), at("the 2-minute rep reveals its answer on tap"));
  // ---- Replies owed ----
  const owed = page.locator(".owed-row");
  await owed.nth(2).waitFor();
  check(await owed.count() === 3 && (await owed.first().locator(".owed-who").textContent()) === "Dana Reed at Penguin Cluster Co", at("replies owed: the brief's two, then the logged reply it does not mention"));
  check(await owed.first().getByRole("link", { name: "Open draft in Gmail" }).getAttribute("href") === "https://mail.google.com/mail/u/0/#drafts?compose=fixture-dana", at("each brief reply opens its Gmail draft"));
  check(await owed.nth(2).getByRole("link", { name: "Find in Gmail" }).getAttribute("href") === "https://mail.google.com/mail/u/0/#search/alex%40example.com", at("a logged reply with no draft finds the thread in Gmail"));
  // ---- Approve: email only, research folded, honest hint ----
  const deck = page.locator("#approve");
  await deck.locator(".deck-card").waitFor();
  check(/1\s*of\s*1/.test(await deck.locator(".deck-count").textContent() ?? ""), at("the approve deck shows emails only (LinkedIn has its own panel)"));
  const why = deck.locator("details.deck-why");
  check(await why.locator("summary").textContent() === "Why this person" && await why.getAttribute("open") === null, at("the research card is folded under Why this person"));
  await why.locator("summary").click();
  check((await why.locator("p").textContent())?.startsWith("Head of Energy at Example Power"), at("Why this person opens the research card"));
  check((await deck.locator(".deck-hint").textContent())?.includes("Sending is paused."), at("the deck repeats that sending is paused"));
  for (const b of ["Approve", "Skip", "Edit"]) check(await deck.getByRole("button", { name: b, exact: true }).count() === 1, at(`the deck card has ${b}`));
  await deck.getByRole("button", { name: "Approve", exact: true }).click();
  await deck.getByText("Approved Alex Example. It waits until sending is turned on.").waitFor();
  check(true, at("approving while paused says the email waits"));
  check(newRpc().some((c) => c.name === "outreach_decide" && c.body.p_decision === "approve" && c.body.p_id === "eeeeeeee-1111-4000-8000-000000000001"), at("Approve goes through outreach_decide"));
  await deck.getByText("All done. Nothing else is waiting for you.").waitFor();
  check(await deck.getByRole("link", { name: /Ask Claude/ }).count() === 0, at("the empty deck on Today offers no extra Claude chat"));
  // ---- LinkedIn: connected people only; the rest wait for a connection ----
  const li = page.locator("#linkedin");
  await li.locator(".li-row").first().waitFor();
  check(await li.locator(".li-list").first().locator(".li-row").count() === 1 && (await li.locator(".li-row .li-who").first().textContent()) === "Priya Shah at Northwind Compute", at("only the connected person appears as a DM to send"));
  check((await li.locator(".li-wait-head p").textContent()) === "1 waiting for connection (send a connection note)", at("everyone else is a count waiting for connection"));
  check(await li.getByText("Hi Alex", { exact: false }).count() === 0, at("a DM to someone not connected is not shown"));
  await li.getByRole("button", { name: "Show connection notes" }).click();
  const note = li.locator(".li-wait .li-row");
  check((await note.locator(".li-note").textContent()) === "Hi Alex, good to meet at DCD. We work on power and compute for AI campuses. Keen to connect.", at("the connection note is the text after the marker"));
  await note.getByRole("button", { name: "Copy" }).click();
  check(await page.evaluate(() => navigator.clipboard.readText()) === "Hi Alex, good to meet at DCD. We work on power and compute for AI campuses. Keen to connect.", at("Copy copies the connection note"));
  check(await note.getByRole("link", { name: "Open profile" }).getAttribute("href") === "https://www.linkedin.com/in/alex-example", at("Open profile opens their LinkedIn"));
  await note.getByRole("button", { name: "Request sent" }).click();
  await page.getByText("Request sent to Alex Example.", { exact: false }).waitFor();
  check(newWrites().some((w) => w.table === "crm_contacts" && w.method === "PATCH" && String(w.body.notes).includes("LinkedIn connection request sent")), at("Request sent notes it on the contact"));
  const ready = li.locator(".li-row").first();
  await ready.getByRole("button", { name: "Copy" }).click();
  check(await page.evaluate(() => navigator.clipboard.readText()) === "Hi Priya, good to see you at DCD. Are you still sourcing 10 MW in the UK for Q2?", at("Copy copies the DM"));
  await ready.getByRole("button", { name: "Mark sent" }).click();
  await page.getByText("Marked sent to Priya Shah on LinkedIn.").waitFor();
  check(newRpc().some((c) => c.name === "outreach_decide" && c.body.p_id === "eeeeeeee-1111-4000-8000-000000000004" && c.body.p_decision === "approve") && newWrites().some((w) => w.table === "outreach" && w.body.status === "sent"), at("Mark sent approves the draft and marks it sent"));
  check(await li.getByText("No DMs ready for people you are connected to.").count() === 1, at("the DM leaves the list once sent"));
  // ---- Signed mandates: one line each, open to the card ----
  const rows = page.locator(".mrow");
  await rows.nth(3).waitFor();
  check(await rows.count() === 4 && (await rows.first().locator(".mrow-rank").textContent()) === "1", at("signed mandates are one-line rows, in rank order"));
  await rows.first().locator(".mchip").first().waitFor();
  check((await rows.first().locator(".mrow-chips").textContent())?.includes("Fee protected ✓"), at("a row carries its paperwork chips"));
  check(await page.locator(".mcard").count() === 0, at("no full cards until a row is opened"));
  await rows.first().locator(".mrow-line").click();
  await rows.first().locator(".mcard").waitFor();
  check(await rows.first().locator('.mcard a[href^="https://claude.ai"]').count() === 0 && await rows.first().getByRole("link", { name: "Work this mandate’s leads" }).first().getAttribute("href") === "#/leads", at("the opened card has no Claude buttons and points to the Leads desk"));
  check(await claudeLinks.count() === 1, at("Today still has one Claude hand-off with a card open"));
  await rows.first().locator(".mrow-line").click();
  check(await page.locator(".mcard").count() === 0, at("the row folds again"));
  check(await page.evaluate(() => document.documentElement.dataset.calm) === "on", at("calm mode is on by default on Today"));
  check(await page.locator(".strip-cell", { hasText: "Sources live" }).count() === 0, at("calm mode hides the strip counters"));
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), at("Today has no sideways scrolling"));
}

/** Pipeline: deals and warm contacts, stalled first, one Claude hand-off per row, Close as dead with Undo. */
async function pipelineFlow(page, label, at, newWrites) {
  await page.goto(`${base}#/pipeline`);
  await page.getByRole("heading", { name: "Pipeline", exact: true }).waitFor();
  const rows = page.locator(".pipe-row");
  await rows.first().waitFor();
  const names = await rows.locator(".pipe-name").allTextContents();
  check(JSON.stringify(names) === JSON.stringify(["Alex Example", "Priya Shah", "Tom Reed", "Campus developer"]), at(`stalled first: overdue deal, then the warm contact with no date, then the rest (got ${names.join(", ")})`));
  check(await rows.nth(0).locator(".pipe-late").textContent().then((t) => /^\d+ days overdue$/.test(t ?? "")) && (await rows.nth(1).locator(".pipe-late").textContent()) === "No date set", at("each row says how late it is"));
  check(await rows.filter({ hasNot: page.locator(".pipe-late.is-late") }).count() === 2 && (await rows.first().locator(".pipe-next").textContent()) === "Send NCNDA", at("rows say what's next; two are not stalled"));
  const nudges = page.getByRole("link", { name: "Draft the nudge" });
  check(await nudges.count() === 4 && await page.locator('a[href^="https://claude.ai/new"]').count() === 4, at("every row has one Draft the nudge and nothing else opens Claude"));
  const nq = new URL((await nudges.first().getAttribute("href")) ?? "https://x");
  check(nq.searchParams.get("project") === "01a0f3c4-b60e-7236-8dea-4bd5402220f3" && (nq.searchParams.get("q") ?? "").startsWith('Nodus command: draft the nudge to Alex Example at Example Power Ltd (alex@example.com) about the deal "Example 20 MW gensets", next step "Send NCNDA".') && (nq.searchParams.get("q") ?? "").includes("Save it as a Gmail draft in that same thread (do not send)"), at("Draft the nudge asks for a Gmail draft in the existing thread"));
  const w0 = newWrites().length;
  await rows.first().getByRole("button", { name: "Close as dead" }).click();
  await page.getByText("Closed Example 20 MW gensets as lost.").waitFor();
  check(newWrites().slice(w0).some((w) => w.table === "deals" && w.method === "PATCH" && w.body.stage === "Closed – lost"), at("Close as dead sets the deal to Closed – lost"));
  check(!(await rows.locator(".pipe-name").allTextContents()).includes("Alex Example"), at("the closed deal leaves the list"));
  await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
  await page.getByText("Undone.").waitFor();
  check(newWrites().slice(w0).some((w) => w.table === "deals" && w.method === "PATCH" && w.body.stage === "Qualified") && (await rows.first().locator(".pipe-name").textContent()) === "Alex Example", at("Undo puts the deal back"));
  await rows.nth(1).getByRole("button", { name: "Close as dead" }).click();
  await page.getByText("Moved Priya Shah to Nurture.").waitFor();
  check(newWrites().slice(w0).some((w) => w.table === "crm_contacts" && w.method === "PATCH" && w.body.stage === "Nurture"), at("Close as dead moves a contact to Nurture"));
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), at("Pipeline has no sideways scrolling"));
}

/** Engine: one screen, four tabs (Map, Best next, Matches, List), the nav item lit on each. */
async function engineTabsFlow(page, label, at) {
  for (const [hash, tab] of [["engine?best=1", "Best next"], ["engine", "Matches"], ["opportunities", "List"], ["map", "Map"]]) {
    await page.goto(`${base}#/${hash}`);
    const bar = page.locator(".engine-tabs").first();
    await bar.waitFor();
    check(JSON.stringify(await bar.locator("a").allTextContents()) === JSON.stringify(["Map", "Best next", "Matches", "List"]) && (await bar.locator("a.active").textContent()) === tab, at(`Engine tabs: ${tab} is lit on #/${hash}`));
    const nav = label === "phone" ? page.locator(".mnav") : page.locator(".rail-primary");
    check((await nav.locator("a.active").textContent())?.replace(/\d+$/, "").trim() === "Engine", at(`the Engine nav item is lit on #/${hash}`));
  }
}

/** Today, Leads desk, Review, Priorities, Pipeline and Engine on the small fixture: every button that writes, at one width. */
async function focusFlow(browser, label, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: "en-GB", timezoneId: "Europe/London" });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  await ctx.route("https://wryvidauwmcczbmstsla.supabase.co/**", fake(true));
  await ctx.route((u) => !u.href.startsWith(base) && !u.href.startsWith("https://wryvidauwmcczbmstsla.supabase.co"), (r) => r.abort());
  await ctx.addInitScript((s) => localStorage.setItem("nodus-console-auth", JSON.stringify(s)), session);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const at = (what) => `${what} (${label})`;
  const rpcBefore = rpcCalls.length;
  const writesBefore = writes.length;
  const newRpc = () => rpcCalls.slice(rpcBefore);
  const newWrites = () => writes.slice(writesBefore);

  await todayFlow(page, label, at, newRpc, newWrites);
  await pipelineFlow(page, label, at, newWrites);
  await engineTabsFlow(page, label, at);

  // Leads desk (under More): mandate cards with New leads and the network, then Background BD
  await page.goto(`${base}#/leads`);
  await page.getByRole("heading", { name: "Signed mandates" }).waitFor();
  await page.locator(".mcard").nth(1).waitFor();
  check(await page.locator(".mcard").nth(1).locator(".mbody").count() === 0 && await page.locator(".mcard").first().locator(".mbody").count() === 1, at("the first mandate card is open and the second is folded"));
  await page.locator(".mcard").nth(1).getByRole("button", { name: /^Open / }).click();
  check(await page.locator(".mcard").nth(1).locator(".mbody").count() === 1, at("a folded card opens with one tap"));
  await page.locator(".mcard").nth(1).getByRole("button", { name: /^Fold / }).click();
  check(await page.locator(".mcard").nth(1).locator(".mbody").count() === 0, at("and folds again"));
  await page.locator(".mcard").first().waitFor();
  const card1 = page.locator(".mcard").first();
  check(await page.locator(".mcard").count() === 2, at("the Leads desk shows the top three priorities as two mandate cards (Al-Risha shares one)"));
  check(await page.locator(".mcard-rank").first().textContent() === "1", at("mandates are in rank order"));
  const wsTabs = card1.locator(".mtabs [role=tab]");
  check(await wsTabs.count() === 2 && (await wsTabs.allTextContents()).join("|").includes("Offtakers") && (await wsTabs.allTextContents()).join("|").includes("Investors"), at("Al-Risha reads as one mandate with two workstreams"));
  await card1.locator(".seal").waitFor();
  check(await card1.locator(".seal").textContent() === "Signed" && (await card1.locator(".mchips").textContent())?.includes("Fee protected ✓"), at("signed badge and fee chip come from the linked deal"));
  // ---- New leads: the default tab, approve / dismiss / undo, batch, keys, Write outbound, Find 50 more ----
  await page.evaluate(() => {
    const open = window.open.bind(window);
    window.__opened = [];
    window.open = (u, ...rest) => (window.__opened.push(String(u)), open(u, ...rest));
  });
  await card1.locator(".lead-row").first().waitFor();
  const ptabs = card1.locator(".ptabs [role=tab]");
  check((await ptabs.allTextContents()).join("|").startsWith("New leads8|In your network") && await ptabs.first().getAttribute("aria-selected") === "true", at("New leads is the first, selected tab with its count"));
  check(rpcCalls.length >= 0 && (await card1.locator(".mchips li.t-new").textContent()) === "11 new leads", at("the card header shows 11 new leads across both workstreams"));
  check(await card1.locator(".lead-row").count() === 6 && (await card1.locator(".lead-row .net-name").first().textContent()) === "Steve St***t", at("the queue shows six, best fit first"));
  const row1 = card1.locator(".lead-row").first();
  check((await row1.locator(".lead-src").textContent()) === "Apollo" && (await row1.locator(".lead-why").textContent())?.startsWith("Buys 20-60 MW") && await row1.locator("a.lead-hook").getAttribute("href") === "https://example.com/northgate-facility", at("a lead row has source, fit reason and hook link"));
  const findHref = (await card1.getByRole("link", { name: "Find 50 more" }).first().getAttribute("href")) ?? "";
  const fq = new URL(findHref).searchParams.get("q") ?? "";
  check(new URL(findHref).searchParams.get("project") === "01a0f3c4-b60e-7236-8dea-4bd5402220f3" && fq.startsWith("Nodus command (priority 1: Al-Risha phase 1: find the offtaker). Deep lead scout: find the 50 best people") && fq.includes('Who we need: "Neoclouds and AI labs needing 50 MW+ in the Middle East"'), at("Find 50 more opens a deep scout in the Nodus project"));
  if (label === "phone" || label === "desktop") { fs.mkdirSync(leadShots, { recursive: true }); await page.waitForTimeout(300); await page.screenshot({ path: path.join(leadShots, `leads-flow-${label}.png`) }); }

  let wL = writes.length;
  await card1.getByRole("button", { name: "Approve Steve St***t" }).click();
  await page.getByText("Approved Steve St***t.").waitFor();
  const ap = writes.slice(wL).find((w) => w.table === "lead_candidates" && w.method === "PATCH");
  check(Boolean(ap) && ap.body.status === "approved" && /^\d{4}-\d{2}-\d{2}T/.test(ap.body.decided_at) && ap.url.includes("1eadcafe-0000-4000-8000-000000000065"), at("Approve writes status approved with decided_at"));
  check(await card1.locator(".lead-row", { hasText: "Steve St***t" }).count() === 0 && (await card1.locator(".lead-ok h5").textContent()) === "Approved (1)" && (await ptabs.first().textContent()) === "New leads7", at("the lead moves to Approved at once and the count drops"));
  await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
  await page.getByText("Undone.").waitFor();
  check(writes.slice(wL).some((w) => w.table === "lead_candidates" && w.method === "PATCH" && w.body.status === "new" && w.body.decided_at === null), at("Undo puts the lead back to new"));
  check(await card1.locator(".lead-row", { hasText: "Steve St***t" }).count() === 1 && await card1.locator(".lead-ok").count() === 0, at("Undo brings the lead straight back"));

  wL = writes.length;
  await card1.getByRole("button", { name: "Dismiss Faisal Q***i" }).click();
  await page.getByText("Dismissed Faisal Q***i.").waitFor();
  check(writes.slice(wL).some((w) => w.table === "lead_candidates" && w.method === "PATCH" && w.body.status === "dismissed"), at("Dismiss writes status dismissed"));
  check(await card1.locator(".lead-row", { hasText: "Faisal Q***i" }).count() === 0, at("a dismissed lead leaves the queue"));

  await card1.getByRole("checkbox", { name: "Lena Hof***n" }).check();
  await card1.locator(".lead-row", { hasText: "Arjun Me***a" }).locator(".net-role").click();
  const lbar = card1.locator(".leads .net-batch");
  await lbar.waitFor();
  check((await lbar.textContent())?.includes("2 selected") && await lbar.getByRole("button", { name: "Approve 2" }).isVisible() && await lbar.getByRole("button", { name: "Dismiss 2" }).isVisible(), at("the lead batch bar offers Approve 2 and Dismiss 2"));
  if (label === "phone") await page.screenshot({ path: path.join(leadShots, "leads-batch-phone.png") });
  await lbar.getByRole("button", { name: "Approve 2" }).click();
  await page.getByText("Approved 2 leads.").waitFor();
  check((await card1.locator(".lead-ok h5").textContent()) === "Approved (2)" && await card1.locator(".leads .net-batch").count() === 0, at("Approve 2 moves both to Approved and the bar goes"));

  if (label === "desktop") {
    await card1.locator(".lead-row").first().focus();
    await page.keyboard.press("j");
    const second = (await card1.locator(".lead-row").nth(1).locator(".net-name").textContent()) ?? "";
    await page.keyboard.press("a");
    await page.getByText(`Approved ${second}.`).waitFor();
    check((await card1.locator(".lead-ok h5").textContent()) === "Approved (3)", at("J then A approves the second lead from the keyboard"));
    const third = (await card1.locator(".lead-row").nth(1).locator(".net-name").textContent()) ?? "";
    check(await page.evaluate(() => document.activeElement?.classList.contains("lead-row")) && (await page.evaluate(() => document.activeElement?.querySelector(".net-name")?.textContent)) === third, at("focus moves to the next lead after a key decision"));
    await page.keyboard.press("x");
    await page.getByText(`Dismissed ${third}.`).waitFor();
    check(await card1.locator(".lead-row", { hasText: third }).count() === 0, at("X dismisses from the keyboard"));
    await page.screenshot({ path: path.join(leadShots, "leads-approved-desktop.png") });
  }

  const nApproved = label === "desktop" ? 3 : 2;
  const pop = page.waitForEvent("popup");
  await card1.getByRole("button", { name: `Write outbound for ${nApproved}` }).click();
  await (await pop).close().catch(() => undefined);
  const opened = await page.evaluate(() => window.__opened);
  const wu = new URL(opened[opened.length - 1] ?? "https://x");
  const wq = wu.searchParams.get("q") ?? "";
  check(opened.length === 1 && wu.searchParams.get("project") === "01a0f3c4-b60e-7236-8dea-4bd5402220f3", at("Write outbound opens one chat in the Nodus project"));
  check(wq.startsWith(`Nodus command (priority 1: Al-Risha phase 1: find the offtaker). Write best-in-class outbound for these ${nApproved} approved leads (lead_candidates ids below).`) &&
    wq.includes("Lena Hof***n, Head of Data Centre Strategy, Kestrel Neocloud (lead 1eadcafe-0000-4000-8000-000000000066, apollo ap00000066)") &&
    wq.includes("Arjun Me***a, Director, Infrastructure, Saffron Labs (lead 1eadcafe-0000-4000-8000-000000000067)"), at("the outbound instruction lists lead ids and Apollo refs"));
  check(await card1.locator(".lead-ok .lead-sent").count() === nApproved && await card1.getByRole("button", { name: /^Write outbound/ }).count() === 0, at("approved leads are marked Sent to Claude"));
  await page.evaluate(() => { window.__opened = []; });

  await card1.getByRole("tab", { name: /^In your network/ }).click();
  await card1.locator(".net-row").first().waitFor();
  check(await card1.locator(".net-row").count() === 5, at("Best in your network shows the top five"));
  check((await ptabs.nth(1).textContent()) === "In your network7", at("the network tab shows its count"));
  check(rpcCalls.some((c) => c.name === "priority_network" && c.body.p_priority === P1), at("network comes from priority_network"));
  check(await card1.getByRole("link", { name: "Draft for me" }).count() === 0, at("there is no per-person Draft for me any more"));

  // Best in your network: tick three people (box, whole row, box), draft them in ONE Claude chat
  check(await card1.locator(".net-batch").count() === 0, at("no batch bar until someone is ticked"));
  await card1.getByRole("checkbox", { name: "Leila Nasser" }).check();
  await card1.locator(".net-row", { hasText: "Karim Aziz" }).locator(".net-role").click();
  await card1.getByRole("checkbox", { name: "Maya Okafor" }).check();
  const bar = card1.locator(".net-batch");
  await bar.waitFor();
  check(await card1.getByRole("checkbox", { name: "Karim Aziz" }).isChecked(), at("tapping anywhere on a row ticks it"));
  check((await bar.textContent())?.includes("3 selected") && (await bar.textContent())?.includes("Priority 1, offtakers"), at("the batch bar says how many and which priority"));
  check(await bar.getByRole("button", { name: "Draft for 3 selected" }).isVisible() && await bar.getByRole("button", { name: "Not now for 3" }).isVisible(), at("the batch bar offers Draft for 3 selected and Not now for 3"));
  const barBox = await bar.boundingBox();
  check(Boolean(barBox) && barBox.y + barBox.height <= viewport.height + 1, at("the batch bar is on screen"));
  fs.mkdirSync(batchShots, { recursive: true });
  await page.screenshot({ path: path.join(batchShots, `batch-${label}.png`) });
  const pop3 = page.waitForEvent("popup");
  await bar.getByRole("button", { name: "Draft for 3 selected" }).click();
  await (await pop3).close().catch(() => undefined);
  const opened3 = await page.evaluate(() => window.__opened);
  const bu = new URL(opened3[0] ?? "https://x");
  const bq = bu.searchParams.get("q") ?? "";
  check(opened3.length === 1, at("Draft for 3 selected opens exactly one chat"));
  check(bu.origin + bu.pathname === "https://claude.ai/new" && bu.searchParams.get("project") === "01a0f3c4-b60e-7236-8dea-4bd5402220f3", at("the chat opens inside the Nodus project"));
  check(bq.startsWith("Nodus command (priority 1: Al-Risha phase 1: find the offtaker). Draft one first message each, for my approval, to these 3 people from my CRM.") &&
    ["Leila Nasser", "Karim Aziz", "Maya Okafor"].every((n) => bq.includes(n)) &&
    bq.includes("1. Leila Nasser, Head of Capacity, Desert Peak Cloud (contact_id cccccccc-7777-4000-8000-000000000065)") &&
    bq.includes("(contact_id cccccccc-7777-4000-8000-000000000066)") && bq.includes("(contact_id cccccccc-7777-4000-8000-000000000067)"), at("one instruction lists all three people with contact ids"));
  check(!/clipboard|paste/i.test(bq), at("the batch instruction never asks for a paste"));
  check(await card1.locator(".net-sent").count() === 3 && await card1.locator(".net-batch").count() === 0, at("the three are marked Sent to Claude and the bar goes"));

  // Selection is per priority and survives switching tabs
  await card1.getByRole("button", { name: /^Select top/ }).click();
  check((await card1.locator(".net-batch").textContent())?.includes("2 selected"), at("Select top 5 skips people already sent to Claude"));
  await card1.getByRole("tab", { name: /Investors/ }).click();
  check(await card1.getByRole("tab", { name: /^New leads/ }).getAttribute("aria-selected") === "true", at("each workstream opens on its own New leads"));
  await card1.getByRole("tab", { name: /^In your network/ }).click();
  await card1.locator(".net-row").first().waitFor();
  check(await card1.locator(".net-batch").count() === 0 && await card1.locator(".mtab-picked").count() === 1, at("the Investors tab has its own selection; Offtakers shows its picks"));
  await card1.getByRole("tab", { name: /Offtakers/ }).click();
  await card1.locator(".net-batch").waitFor();
  check((await card1.locator(".net-batch").textContent())?.includes("2 selected"), at("picks come back with the tab"));
  await card1.getByRole("button", { name: "Clear" }).click();
  check(await card1.locator(".net-batch").count() === 0, at("Clear empties the selection"));

  // Not now on one row, then Undo
  const wNot = writes.length;
  await card1.getByRole("button", { name: "Not now: Yusuf Demir" }).click();
  await page.getByText("Not now: Yusuf Demir. Back in 60 days.").waitFor();
  const ins = writes.slice(wNot).find((w) => w.table === "network_dismissals" && w.method === "POST");
  check(Boolean(ins) && /on_conflict=priority_id%2Ccontact_id|on_conflict=priority_id,contact_id/.test(ins.url) && Array.isArray(ins.body) && ins.body[0].priority_id === P1 && ins.body[0].contact_id === "cccccccc-7777-4000-8000-000000000068" && ins.body[0].reason === null && /^\d{4}-\d{2}-\d{2}$/.test(ins.body[0].until), at("Not now upserts a network_dismissals row with a 60-day end"));
  check(await card1.locator(".net-row", { hasText: "Yusuf Demir" }).count() === 0 && await card1.locator(".net-row").count() === 5, at("the person leaves the list at once and the next one moves up"));
  if (label === "phone") { await page.waitForTimeout(400); await page.screenshot({ path: path.join(batchShots, "not-now-toast-phone.png") }); }
  await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
  await page.getByText("Undone.").waitFor();
  check(writes.slice(wNot).some((w) => w.table === "network_dismissals" && w.method === "DELETE" && w.url.includes("cccccccc-7777-4000-8000-000000000068")), at("Undo deletes the dismissal"));
  check(await card1.locator(".net-row", { hasText: "Yusuf Demir" }).count() === 1, at("Undo brings the person straight back"));

  // Not now for the batch, then Bring back from Dismissed
  await card1.getByRole("checkbox", { name: "Yusuf Demir" }).check();
  await card1.locator(".net-batch").getByRole("button", { name: "Not now for 1" }).click();
  await page.getByText("Not now: Yusuf Demir. Back in 60 days.").waitFor();
  await page.locator(".toast").getByRole("button", { name: "Not a fit" }).click();
  await page.getByText("Noted: not a fit.").waitFor();
  check(writes.slice(wNot).some((w) => w.table === "network_dismissals" && w.method === "POST" && w.body[0]?.reason === "Not a fit"), at("a one-tap reason is saved"));
  await card1.getByRole("button", { name: "Dismissed (1)" }).click();
  await card1.locator(".net-gone").getByText("Yusuf Demir").waitFor();
  await card1.getByRole("button", { name: "Bring back Yusuf Demir" }).click();
  await page.getByText("Brought back Yusuf Demir.").waitFor();
  check(await card1.locator(".net-row", { hasText: "Yusuf Demir" }).count() === 1 && await card1.getByRole("button", { name: /^Dismissed/ }).count() === 0, at("Bring back puts them back on the list"));
  check(rpcCalls.some((c) => c.name === "priority_network" && c.body.p_priority === P1 && c.body.p_limit === 20), at("the network asks for 20 rows so the list stays full after filtering"));
  check(await card1.locator(".net-row").first().getByRole("link", { name: /^Contact/ }).getAttribute("href") === "#/contacts?id=cccccccc-7777-4000-8000-000000000065", at("Contact opens the contact page"));
  await card1.getByRole("button", { name: "See all 7" }).click();
  check(await card1.locator(".net-row").count() === 7, at("See all expands the network list"));
  await card1.getByRole("tab", { name: /Investors/ }).click();
  await card1.locator(".net-row").first().waitFor();
  check((await card1.locator(".net-row").first().locator(".net-name").textContent()) === "Omar Haddad" && (await card1.locator(".mcard-rank").textContent()) === "2", at("the Investors tab shows priority 2 and its own network"));
  await card1.getByRole("tab", { name: /Offtakers/ }).click();
  await page.getByRole("button", { name: "Show 2 more" }).click();
  check(await page.locator(".mcard").count() === 4, at("Show 2 more reveals the rest"));
  check(await page.evaluate(() => document.documentElement.dataset.calm) === "on", at("calm mode is on by default on the Leads desk"));
  check(await page.locator(".strip-cell", { hasText: "Sources live" }).count() === 0, at("calm mode hides the strip counters"));

  const ask = card1.getByRole("link", { name: "Ask Claude", exact: true });
  const href = (await ask.getAttribute("href")) ?? "";
  const q = new URL(href).searchParams.get("q") ?? "";
  check(href.startsWith("https://claude.ai/new?q=") && new URL(href).searchParams.get("project") === "01a0f3c4-b60e-7236-8dea-4bd5402220f3" && q.startsWith("Nodus command (priority 1: Al-Risha phase 1: find the offtaker): Reach 25 neoclouds") && q.split("\n\nBefore doing anything:")[0].endsWith("tag drafts with priority 1.") && q.includes("Before doing anything: search what has already been done"), at("Ask Claude opens claude.ai with the ready instruction"));
  const popup = page.waitForEvent("popup");
  await ask.click();
  await (await popup).close().catch(() => undefined);
  await page.getByText("Opened a Nodus chat with the instruction filled in. Press send there.").waitFor();
  check(true, at("Ask Claude says the chat is filled in, with nothing to paste"));
  await card1.locator(".ask-menu summary").click();
  check(await card1.getByRole("link", { name: "What's blocking this?" }).isVisible(), at("preset asks are offered"));
  await card1.locator(".ask-menu summary").click();
  check(await card1.getByRole("link", { name: "Review 1 draft" }).getAttribute("href") === `#/review?priority=${P1}`, at("Review drafts jumps to that priority's drafts"));

  // ---- Background BD: pipeline strip, Process 25 now, the same lead queue for leads with no priority ----
  const bd = page.locator("#bd");
  await bd.locator(".lead-row").first().waitFor();
  const strip = (await bd.locator(".bd-strip").textContent()) ?? "";
  check(strip.includes("32 routed to mandates") && strip.includes("820 in background queue") && strip.includes("5 leads waiting for you") && strip.includes("15 processed each evening"), at("the pipeline strip counts bd_queue by tier and the leads waiting"));
  const procHref = (await bd.getByRole("link", { name: "Process 25 now" }).getAttribute("href")) ?? "";
  const pq = new URL(procHref).searchParams.get("q") ?? "";
  check(bd.getByRole("link", { name: "Process 25 now" }) && await bd.getByRole("link", { name: "Process 25 now" }).count() === 1 && new URL(procHref).searchParams.get("project") === "01a0f3c4-b60e-7236-8dea-4bd5402220f3" && pq.startsWith("Nodus command: run background BD now. Take the next 25 from bd_queue (order by tier, bd_score desc)") && pq.includes("Report how many were queued per mandate."), at("Process 25 now opens one chat in the Nodus project"));
  check(await bd.locator(".lead-row").count() === 5, at("Background BD lists its five leads"));
  const bd1 = bd.locator(".lead-row").first();
  check((await bd1.locator(".lead-line").textContent()) === "Capital" && (await bd1.locator("a.lead-hook").textContent()) === "Kestrel Ridge closes second infrastructure fund" && await bd1.locator("a.lead-hook").getAttribute("href") === "https://example.com/evidence-1", at("a background lead shows its line chip and the opportunity as the hook with evidence"));
  check((await bd.locator(".lead-row").nth(1).locator(".lead-line").textContent()) === "Powered land", at("powered land leads say so"));
  let wB = writes.length;
  await bd.getByRole("checkbox", { name: "Rhea S***n" }).check();
  await bd.getByRole("checkbox", { name: "Tomas Lin***d" }).check();
  check((await bd.locator(".net-batch").textContent())?.includes("Background BD"), at("the background batch bar says Background BD"));
  await bd.locator(".net-batch").getByRole("button", { name: "Approve 2" }).click();
  await page.getByText("Approved 2 leads.").waitFor();
  check(writes.slice(wB).some((w) => w.table === "lead_candidates" && w.method === "PATCH" && w.body.status === "approved" && w.url.includes("bdbdbdbd-0000-4000-8000-000000000001")), at("approving a background lead writes lead_candidates"));
  await page.evaluate(() => { window.__opened = []; });
  const popBd = page.waitForEvent("popup");
  await bd.getByRole("button", { name: "Write outbound for 2" }).click();
  await (await popBd).close().catch(() => undefined);
  const bdq = new URL((await page.evaluate(() => window.__opened))[0] ?? "https://x").searchParams.get("q") ?? "";
  check(bdq.startsWith("Nodus command (background BD, no priority). Write best-in-class outbound for these 2 approved leads") && bdq.includes("Rhea S***n, Managing Partner, Kestrel Ridge Infrastructure (lead bdbdbdbd-0000-4000-8000-000000000001, engine ap00000384, opportunity 0bb0bb00-0000-4000-8000-000000000001)"), at("Write outbound for background leads says no priority and carries the opportunity id"));
  check(await bd.locator(".lead-ok .lead-sent").count() === 2, at("background approved leads are marked Sent to Claude"));
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), at("the front page has no sideways scrolling with Background BD"));

  // Review (under More, not in the nav): every draft, email and LinkedIn, one at a time, priority 1 first
  await page.goto(`${base}#/review`);
  await page.locator(".deck-card").waitFor();
  check(/1\s*of\s*3/.test(await page.locator(".deck-count").textContent() ?? ""), at("Review shows 1 of 3 (email and LinkedIn)"));
  check(await page.locator(".deck-card .ptag").textContent() === "Priority 1: Al-Risha phase 1: find the offtaker", at("priority-tagged draft comes first"));
  if (label === "desktop") await page.keyboard.press("a");
  else await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.locator(".deck-last").waitFor();
  check((await page.locator(".deck-last").textContent()) === "Approved Alex Example. It waits until sending is turned on.", at("with sending paused, approving says it waits (no send time is claimed)"));
  check(newRpc().some((c) => c.name === "outreach_decide" && c.body.p_decision === "approve" && c.body.p_id === "eeeeeeee-1111-4000-8000-000000000001"), at(`${label === "desktop" ? "A key" : "Approve"} goes through outreach_decide`));
  check(/2\s*of\s*3/.test(await page.locator(".deck-count").textContent() ?? ""), at("the deck moves on to 2 of 3"));
  await page.evaluate(() => {
    const open = window.open.bind(window);
    window.__opened = [];
    window.open = (u, ...rest) => (window.__opened.push(String(u)), open(u, ...rest));
  });
  const li = page.waitForEvent("popup");
  await page.getByRole("button", { name: /Copy & open LinkedIn/ }).click();
  await (await li).close().catch(() => undefined);
  check((await page.evaluate(() => window.__opened))[0] === "https://www.linkedin.com/in/alex-example", at("Copy & open LinkedIn opens the profile"));
  check(await page.evaluate(() => navigator.clipboard.readText()) === "Hi Alex, good to connect.", at("Copy & open LinkedIn copies the message"));
  await page.getByRole("button", { name: "Mark sent" }).click();
  await page.locator(".deck-count", { hasText: /3\s*of\s*3/ }).waitFor();
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByText("All done. Nothing else is waiting for you.").waitFor();
  check(newWrites().some((w) => w.table === "outreach" && w.body.status === "sent"), at("Mark sent uses the existing sent path"));
  check(!newRpc().some((c) => c.name === "outreach_decide" && c.body.p_id === "eeeeeeee-1111-4000-8000-000000000002"), at("an approved LinkedIn item is not approved twice"));

  // Review: skip and edit (a fresh load: the deck above is already at "All done")
  await page.goto(`${base}#/review`);
  await page.reload();
  await page.getByRole("heading", { name: "Review", exact: true }).waitFor();
  await page.locator(".deck-card").waitFor();
  if (label === "desktop") {
    await page.keyboard.press("e");
    await page.locator(".deck-edit textarea").waitFor();
  } else {
    await page.getByRole("button", { name: "Edit" }).click();
  }
  await page.locator(".deck-edit textarea").fill("Hello Alex,\nShorter note.");
  await page.getByRole("button", { name: "Save edit" }).click();
  await page.getByText("Edit saved.").waitFor();
  check(newRpc().some((c) => c.name === "outreach_decide" && c.body.p_decision === "edit" && c.body.p_body === "Hello Alex,\nShorter note."), at("Review edit saves through outreach_decide"));
  if (label === "desktop") await page.keyboard.press("s");
  else await page.getByRole("button", { name: "Skip" }).click();
  await page.locator(".deck-last").waitFor();
  check(newRpc().some((c) => c.name === "outreach_decide" && c.body.p_decision === "skip"), at(`${label === "desktop" ? "S key" : "Skip"} uses the skip path`));
  check(await page.locator(".deck-card").getByRole("button", { name: "Skip" }).count() === 0, at("an approved LinkedIn item has no Skip"));
  if (label === "phone") await page.screenshot({ path: path.join(shots, "review-small-phone.png") });
  await page.goto(`${base}#/review?priority=${P1}`);
  await page.locator(".deck-card").waitFor();
  check(/1\s*of\s*1/.test(await page.locator(".deck-count").textContent() ?? "") && await page.locator('.pfilter a[aria-current="page"]').textContent().then((t) => t?.includes("Al-Risha")), at("Review can be filtered to one priority"));

  // Priorities: edit, move, pause, add
  await page.goto(`${base}#/priorities`);
  await page.getByRole("heading", { name: "Priorities", exact: true }).waitFor();
  check(await page.locator(".pcard").count() === 5, at("Priorities lists every live priority"));
  await page.getByRole("button", { name: "Edit Al-Risha phase 1: find the offtaker" }).click();
  await page.getByLabel("Next action").fill("Send the teaser to 25 neoclouds");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Priority saved.").waitFor();
  check(newWrites().some((w) => w.table === "priorities" && w.method === "PATCH" && w.body.next_action === "Send the teaser to 25 neoclouds" && /id=eq\.abababab-0000-4000-8000-000000000001/.test(w.url)), at("editing a priority writes to priorities"));
  await page.getByRole("button", { name: "Edit Mindstream ~$100m convertible note" }).click();
  await page.getByRole("button", { name: "Move up" }).click();
  await page.getByText("Moved up.").waitFor();
  const ranks = newWrites().filter((w) => w.table === "priorities" && "rank" in w.body).map((w) => w.body.rank);
  check(ranks.includes(1) && ranks.includes(2), at("Move up swaps the ranks"));
  await page.getByRole("button", { name: "Edit Optio: find borrowers" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByText("Paused.", { exact: false }).first().waitFor();
  check(newWrites().some((w) => w.table === "priorities" && w.body.status === "paused"), at("Pause sets the status"));
  await page.getByRole("button", { name: "+ Add a priority" }).click();
  await page.getByPlaceholder("What are we trying to close?").fill("GPU lot for Quarry");
  await page.getByRole("button", { name: "Add priority" }).click();
  await page.getByText("Priority added.").waitFor();
  check(newWrites().some((w) => w.table === "priorities" && w.method === "POST" && w.body.title === "GPU lot for Quarry" && w.body.rank === 6 && w.body.status === "active"), at("Add a priority inserts at the bottom"));
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), at("Priorities has no sideways scrolling"));

  // Shell: three primary places, the rest under More
  const nav = label === "phone" ? page.locator(".mnav") : page.locator(".rail-primary");
  const names = (await nav.getByRole("link").allTextContents()).map((t) => t.replace(/\d+$/, "").trim());
  check(JSON.stringify(names) === JSON.stringify(["Today", "Pipeline", "Engine"]), at(`primary nav is Today, Pipeline, Engine (got ${names.join(", ")})`));
  check(await nav.getByRole("link", { name: /Review/ }).count() === 0, at("Review is not in the nav"));
  if (label === "phone") await page.getByRole("button", { name: "More" }).click();
  else await page.locator(".rail-more").click();
  const more = label === "phone" ? page.locator(".msheet") : page.locator("#rail-more");
  const moreNames = await more.getByRole("link").allTextContents();
  check(["Leads desk", "Mandates", "Priorities", "Contacts", "Deals", "Import"].every((n) => moreNames.includes(n)) && !moreNames.some((n) => /^Review/.test(n)), at("More holds the work pages and data, without Review"));
  await more.getByRole("link", { name: "Daily report" }).click();
  await page.getByRole("heading", { name: "Daily report", exact: true }).waitFor();
  check(true, at("the old cockpit is the Daily report under More"));
  await page.locator(".strip-calm").click();
  check(await page.evaluate(() => document.documentElement.dataset.calm) === "on" && await page.evaluate(() => localStorage.getItem("nodus-calm")) === "on", at("calm toggle is remembered in this browser"));
  check(errors.length === 0, at(`no script errors on Today, Pipeline, Engine, Leads desk, Review and Priorities${errors.length ? `: ${errors.join("; ")}` : ""}`));
  await ctx.close();
}

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  if (!process.env.SMOKE_SHOTS_ONLY) {
  // ---------- approved user, phone width ----------
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true, locale: "en-GB", timezoneId: "Europe/London" });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  await ctx.route("https://wryvidauwmcczbmstsla.supabase.co/**", fake(true));
  await ctx.route((u) => !u.href.startsWith(base) && !u.href.startsWith("https://wryvidauwmcczbmstsla.supabase.co"), (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(base);
  await page.getByRole("button", { name: "Sign in" }).waitFor();
  check(await page.locator('meta[name="robots"][content*="noindex"]').count() === 1, "noindex meta tag present");
  await page.getByLabel("Email").fill("kuran@nodus.partners");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("That email and password do not match").waitFor();
  check(true, "wrong password shows a plain-English message");
  await page.getByLabel("Password").fill("right-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("heading", { name: "Focus session" }).waitFor();
  check(true, "signing in opens Today");
  await page.goto(`${base}#/today`);
  await page.getByRole("heading", { name: "Daily report" }).waitFor();
  await page.getByText("Ealing 50 MW site could serve the London hyperscaler need").waitFor();
  check(await page.getByText("£0.00").isVisible(), "Today shows Claude API spend £0.00");
  check(await page.getByText("Waiting for AI reading").isVisible(), "Today shows AI queue");
  check(await page.getByText("Example Trading LLC").isVisible(), "Today shows blocked items");
  check(await page.getByText("Most reliable ten").isVisible(), "Today shows new signals");
  check(await page.locator(".bar-row").first().isVisible(), "score bars render");
  await page.screenshot({ path: path.join(shots, "console-today.png"), fullPage: false });

  await page.getByRole("button", { name: "Shortlist" }).first().click();
  await page.getByText("Shortlisted.").waitFor();
  check(rpcCalls.some((c) => c.name === "match_decide" && c.body.p_action === "shortlist"), "Shortlist calls match_decide");

  await page.getByRole("heading", { name: "Scoreboard" }).waitFor();
  check(await page.getByText("Fee letters signed").isVisible(), "Today shows the weekly scoreboard");
  await page.locator("section", { has: page.getByRole("heading", { name: "Scoreboard" }) }).screenshot({ path: path.join(shots, "console-scoreboard.png") });
  check(rpcCalls.filter((c) => c.name === "scoreboard").length >= 2, "scoreboard asked for this week and last week");

  await page.getByRole("button", { name: "Reject…" }).first().click();
  const confirmReject = page.getByRole("button", { name: "Confirm reject" }).first();
  check(await confirmReject.isDisabled(), "Reject needs a reason first");
  await page.getByLabel("Reason").first().selectOption("wrong_geography");
  await page.locator(".reject-form").first().screenshot({ path: path.join(shots, "console-reject.png") });
  await confirmReject.click();
  await page.getByText("Rejected. The engine will learn from this.").waitFor();
  check(rpcCalls.some((c) => c.name === "match_reject" && c.body.p_reason === "wrong_geography" && c.body.p_note === null), "Reject calls match_reject with the reason");

  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Send to CRM" }).first().click();
  const file = await dl;
  check(/^nodus-match-99999999-\d{4}-\d{2}-\d{2}\.json$/.test(file.suggestedFilename()), "Send to CRM downloads a JSON file");

  await page.goto(`${base}#/opportunities`);
  await page.getByRole("heading", { name: "Opportunities" }).waitFor();
  await page.getByText("Ealing 50 MW grid-connected site with accepted offer").waitFor();
  check(true, "Opportunities list renders");
  await page.getByRole("link", { name: "Ealing 50 MW grid-connected site with accepted offer" }).click();
  await page.getByRole("heading", { name: "Step" }).waitFor();
  check(await page.getByText("I confirm the NCNDA and fee protection are signed").isVisible(), "gate control asks for confirmation before Protected");
  check(await page.getByText("Checked the TEC register").count() === 1, "gate history shows");
  await page.getByLabel(/Why are you moving it on/).fill("NCNDA signed today");
  await page.getByText("I confirm the NCNDA and fee protection are signed").click();
  await page.getByRole("button", { name: /Move from Qualified to Protected/ }).click();
  await page.getByText("Moved on to Protected.").waitFor();
  check(rpcCalls.some((c) => c.name === "gate_advance" && c.body.p_confirmed === true && c.body.p_reason === "NCNDA signed today"), "gate_advance called with reason and confirmation");

  // Step 11: decision makers on the opportunity page
  await page.getByRole("heading", { name: "Decision makers" }).waitFor();
  check(await page.getByRole("heading", { name: "Jane Smith" }).isVisible(), "people panel lists the decision maker");
  check(await page.getByText("You know them").isVisible(), "warm path is highlighted");
  check(await page.getByText("Held by sanctions screening.").isVisible() && (await page.getByText("Hidden Person").count()) === 0, "a held person's name is hidden");
  check(await page.getByText("Draft first line — for you to edit and send yourself. Nothing is sent.").isVisible(), "draft first line is labelled");
  check(await page.getByText("Contact details are internal. Nothing identifying leaves Nodus before Protected.").isVisible(), "internal-only notice shows");
  check(await page.getByRole("button", { name: /^Enrich/ }).isDisabled(), "Enrich is disabled while a request waits for approval");
  await page.getByRole("button", { name: "Approve 30 credits" }).click();
  await page.getByText("Approved. It will run at the next enrichment run.").waitFor();
  check(rpcCalls.some((c) => c.name === "enrich_approve" && c.body.p_credits === 30), "Approve calls enrich_approve with the estimate");
  const vcf = page.waitForEvent("download");
  await page.getByRole("button", { name: "Add to CRM" }).click();
  await page.getByLabel("Details for your CRM").waitFor();
  check(rpcCalls.some((c) => c.name === "person_crm_mark"), "Add to CRM calls person_crm_mark");
  await page.getByRole("button", { name: "Download contact card (.vcf)" }).click();
  check((await vcf).suggestedFilename() === "jane-smith.vcf", "contact card downloads as a .vcf");
  await page.screenshot({ path: path.join(shots, "console-people.png"), fullPage: false });

  await page.goto(`${base}#/matches/99999999-0000-4000-8000-000000000001`);
  await page.getByRole("button", { name: "Enrich both sides" }).click();
  await page.getByText("Still Unverified. Qualify it first").waitFor();
  check(await page.getByText("Queued. People appear here after the next enrichment run.").first().isVisible(), "Enrich both sides shows each side's reason");
  check(rpcCalls.some((c) => c.name === "enrich_request" && c.body.p_match === "99999999-0000-4000-8000-000000000001"), "Enrich both sides calls enrich_request with the match");

  await page.goto(`${base}#/spend`);
  await page.getByRole("heading", { name: "Spend", exact: true }).waitFor();
  check(await page.getByText("6 / 300").isVisible(), "Spend shows credits used against the monthly cap");
  check(await page.getByRole("heading", { name: "Waiting for your approval (1)" }).isVisible(), "Spend lists requests waiting for approval");
  check(await page.getByRole("link", { name: "NOD-11111111" }).first().isVisible(), "Spend links opportunities by reference");
  await page.screenshot({ path: path.join(shots, "console-spend.png"), fullPage: false });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Spend has no sideways scrolling at phone width");

  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search everything" }).fill("ealing");
  await page.getByRole("searchbox", { name: "Search everything" }).press("Enter");
  await page.getByRole("heading", { name: "Search" }).waitFor();
  await page.getByRole("heading", { name: /^Opportunities \(1\)$/ }).waitFor();
  check(await page.getByRole("heading", { name: /^Organisations \(1\)$/ }).isVisible(), "Search shows grouped results with counts");
  check(rpcCalls.some((c) => c.name === "search_all" && c.body.q === "ealing"), "nav search calls search_all");
  await page.screenshot({ path: path.join(shots, "console-search.png"), fullPage: false });
  await page.getByRole("link", { name: "Ealing Power Holdings Limited" }).click();
  await page.getByRole("heading", { name: "Ealing Power Holdings Limited" }).waitFor();
  check(true, "search result links to the organisation page");

  // ---------- CRM (merged from the old HQ) ----------
  await page.goto(`${base}#/today`);
  await page.getByRole("heading", { name: "Approvals" }).waitFor();
  check(await page.locator(".nav-count").first().textContent() === "2", "the nav shows a drafts badge on Today");
  check(await page.getByRole("link", { name: "Approve on Today" }).getAttribute("href") === "#/", "the Daily report points approvals to Today instead of a second queue");
  check(await page.getByRole("button", { name: "Approve all shown" }).count() === 0, "there is no bulk approve on the Daily report");
  check(await page.getByText("Chase the NCNDA").isVisible(), "the Daily report lists actions to do first");
  check(await page.getByRole("link", { name: "Example 20 MW gensets" }).isVisible(), "the Daily report lists deals due");
  await page.screenshot({ path: path.join(shots, "console-today-crm.png"), fullPage: false });
  await page.getByRole("checkbox", { name: /Chase the NCNDA/ }).click();
  await page.waitForTimeout(300);
  check(writes.some((w) => w.table === "crm_actions" && w.body.status === "done"), "ticking an action marks it done");

  await page.goto(`${base}#/contacts`);
  await page.getByRole("heading", { name: "Contacts", exact: true }).waitFor();
  await page.getByRole("button", { name: "Alex Example" }).click();
  await page.getByLabel("Add a note").fill("Called, wants pricing");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved.").waitFor();
  const cw = writes.find((w) => w.table === "crm_contacts");
  check(Boolean(cw && /^2026-10-01: Met at DCD\n\d{4}-\d{2}-\d{2}: Called, wants pricing$/.test(cw.body.notes)), "contact note is appended with a date");
  check(await page.getByText("Bridge power for your Ealing build").isVisible(), "contact panel shows outreach history");
  await page.screenshot({ path: path.join(shots, "console-contacts.png"), fullPage: false });

  await page.goto(`${base}#/deals`);
  await page.getByRole("heading", { name: "Deals", exact: true }).waitFor();
  await page.getByText("gates 1/5").first().waitFor();
  check(true, "deal shows its gate score");
  await page.getByRole("button", { name: "Example 20 MW gensets" }).click();
  await page.locator(".detail-panel select").nth(1).selectOption("Protected");
  await page.getByText("Protected needs NCNDA signed and Fee agreement signed to be Yes first.").waitFor();
  check(await page.locator(".detail-panel").getByRole("button", { name: "Save", exact: true }).isDisabled(), "Protected is blocked until NCNDA and fee are signed");
  await page.screenshot({ path: path.join(shots, "console-deals.png"), fullPage: false });

  await page.goto(`${base}#/outreach?status=manual`);
  await page.getByRole("heading", { name: "Outreach", exact: true }).waitFor();
  await page.getByRole("link", { name: "LinkedIn to send (1)" }).waitFor();
  check(true, "Outreach tabs show counts");

  await page.goto(`${base}#/mandates`);
  await page.getByText("Partial", { exact: true }).first().waitFor();
  check(await page.getByText("$20–50m").isVisible(), "mandate card fields show");

  await page.goto(`${base}#/import`);
  await page.getByText("One-off: brings your old HQ contacts").waitFor();
  await page.locator('input[type="file"]').setInputFiles({ name: "hq.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ export: "nodus-hq", date: "2026-10-22", contacts: [{}], deals: [], actions: [], outreach: [], mandates: [] })) });
  await page.getByRole("button", { name: "Import now" }).click();
  await page.getByText("Imported.").waitFor();
  check(rpcCalls.some((c) => c.name === "crm_import" && c.body.p?.export === "nodus-hq"), "Import sends the parsed file to crm_import");
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "CRM pages have no sideways scrolling at phone width");

  // ---------- Map and Engine (phone) ----------
  await page.goto(`${base}#/map`);
  await page.getByRole("heading", { name: "Map", exact: true }).waitFor();
  await page.getByText("By region").waitFor();
  check(await page.locator(".maplibregl-canvas").count() === 1 || await page.locator(".map-note").count() > 0, "Map draws a map canvas (or explains why not)");
  check(rpcCalls.length > 0 && await page.getByRole("button", { name: "Critical power" }).isVisible(), "Map shows line filters");
  check(await page.getByRole("button", { name: "Critical power" }).getAttribute("aria-pressed") === "false", "Map leaves critical power off by default");
  await page.getByRole("button", { name: "Critical power" }).click();
  check(/lines=all/.test(page.url()), "Map critical power toggle brings it back");
  await page.getByRole("button", { name: "UK" }).click();
  check(/region=UK/.test(page.url()), "Map region filter is kept in the address");
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Map has no sideways scrolling at phone width");

  await page.goto(`${base}#/engine`);
  await page.getByRole("heading", { name: "Engine", exact: true }).waitFor();
  await page.locator(".engine-svg .link").first().waitFor({ state: "attached" });
  check(await page.locator(".engine-svg .link").count() === 1, "Engine hides critical power by default");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.waitForTimeout(200);
  check(await page.locator(".engine-svg .link").count() === 2 && /line=all/.test(page.url()), "Engine 'All' brings critical power back");
  await page.goto(`${base}#/engine?line=all`);
  await page.locator(".engine-svg .link").first().waitFor({ state: "attached" });
  check(await page.locator(".engine-svg .link").count() >= 1, "Engine draws match lines");
  await page.getByRole("list", { name: "Strongest matches" }).getByRole("button").first().click();
  await page.getByText("Score breakdown").waitFor();
  await page.locator(".engine-panel .bar-row").nth(5).waitFor();
  check(await page.locator(".engine-panel .bar-row").count() >= 6, "Engine shows the score breakdown");
  await page.locator(".engine-panel").getByRole("button", { name: "Shortlist" }).click();
  await page.locator(".engine-panel").getByText("Shortlisted.").waitFor();
  check(rpcCalls.filter((c) => c.name === "match_decide" && c.body.p_action === "shortlist").length >= 2, "Shortlist works from the engine view");
  await page.locator(".engine-panel").getByRole("button", { name: "Reject…" }).click();
  check(await page.locator(".engine-panel").getByRole("button", { name: "Confirm reject" }).isDisabled(), "Engine reject needs a reason");
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Engine has no sideways scrolling at phone width");

  for (const [hash, heading] of [["#/matches", "Matches"], ["#/signals", "Signals"], ["#/mandates", "Mandates"], ["#/sources", "Sources"]]) {
    await page.goto(`${base}${hash}`);
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    check(true, `${heading} page renders`);
  }
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no sideways scrolling at phone width");
  check(errors.length === 0, `no script errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
  await ctx.close();

  // ---------- signed in but not approved ----------
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx2.route("https://wryvidauwmcczbmstsla.supabase.co/**", fake(false));
  const p2 = await ctx2.newPage();
  await p2.goto(base);
  await p2.getByLabel("Email").fill("someone@example.com");
  await p2.getByLabel("Password").fill("right-password");
  await p2.getByRole("button", { name: "Sign in" }).click();
  await p2.getByText("This account isn't approved for the Nodus console.").waitFor();
  check(true, "unapproved account sees the not-approved message");
  await ctx2.close();

  // ---------- no brief yet: the note shows and live Do now items still work ----------
  {
    const nb = { ...fx, tables: { ...fx.tables, daily_briefs: [] } };
    const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-GB", timezoneId: "Europe/London" });
    await ctx3.route("https://wryvidauwmcczbmstsla.supabase.co/**", fake(true, nb));
    await ctx3.route((u) => !u.href.startsWith(base) && !u.href.startsWith("https://wryvidauwmcczbmstsla.supabase.co"), (r) => r.abort());
    await ctx3.addInitScript((s) => localStorage.setItem("nodus-console-auth", JSON.stringify(s)), session);
    const p3 = await ctx3.newPage();
    await p3.goto(base);
    await p3.locator(".do-row").nth(2).waitFor();
    await p3.locator(".home-headline:not([aria-busy])").waitFor();
    const note = (await p3.locator(".home-headline").textContent()) ?? "";
    check(/^Today’s brief arrives at 06:40\.|^No brief at weekends\./.test(note), `with no brief, Today says when it arrives (got "${note}")`);
    check((await p3.locator(".do-row .do-text").allTextContents()).join("|") === "Answer 1 reply|Approve 3 drafts|Approve or dismiss 18 new leads", "with no brief, live items stand in for the focus session");
    check((await p3.locator(".sendline").textContent())?.startsWith("Sending is paused."), "with no brief, sending is never claimed");
    check(await p3.locator(".home-calls").count() === 0, "with no brief, there is no calls or digest panel");
    await p3.screenshot({ path: path.join(frontShots, "front-no-brief-phone.png") });
    await ctx3.close();
  }

  // ---------- Focus, Review and Priorities at phone and desktop width ----------
  for (const [label, viewport] of [["phone", { width: 390, height: 844 }], ["desktop", { width: 1440, height: 900 }]]) {
    await focusFlow(browser, label, viewport);
  }
  }

  // ---------- screenshots with fuller fake data: desktop 1440 and phone 390 ----------
  const syn = synthetic();
  const fd = focusData();
  const seqd = sequencerData([...fx.tables.opportunities, ...syn.opportunities], fd.priorities);
  const big = {
    ...fx,
    tables: {
      ...fx.tables,
      opportunities: [...fx.tables.opportunities, ...syn.opportunities],
      v_match_cards: [...fx.tables.v_match_cards, ...syn.matches],
      matches: syn.matches.map((m) => ({ id: m.id, status: m.status, total_score: m.total_score, supply_opportunity_id: m.supply_id, need_opportunity_id: m.need_id })),
      mandates: [...fx.tables.mandates, ...syn.mandates],
      deals: [...fx.tables.deals, ...syn.deals, ...fd.deals],
      priorities: fd.priorities,
      priority_progress: fd.progress,
      outreach: fd.outreach,
      crm_contacts: [...fx.tables.crm_contacts, ...fd.contacts],
      connector_runs: [{ finished_at: new Date(Date.now() - 5 * 3600e3).toISOString() }],
      ...seqd,
    },
    counts: { ...fx.counts, sources: 41 },
  };
  const passes = [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]].filter(([n]) => !process.env.SMOKE_PASS || process.env.SMOKE_PASS === n);
  for (const [name, viewport] of passes) {
    const c = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: "en-GB", timezoneId: "Europe/London" });
    await c.route("https://wryvidauwmcczbmstsla.supabase.co/**", fake(true, big));
    await c.route((u) => !u.href.startsWith(base) && !u.href.startsWith("https://wryvidauwmcczbmstsla.supabase.co"), (r) => r.abort());
    await c.addInitScript((s) => localStorage.setItem("nodus-console-auth", JSON.stringify(s)), session);
    const p = await c.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    if (process.env.SMOKE_DEBUG) p.on("console", (m) => m.type() !== "log" && console.log(`  [${name} console ${m.type()}] ${m.text().slice(0, 400)}`));
    // ---- Today: sending paused, then on ----
    const v3 = process.env.V3_SHOTS || shots;
    fs.mkdirSync(v3, { recursive: true });
    await p.goto(base);
    await p.getByRole("heading", { name: "Focus session" }).waitFor();
    await p.locator("#approve .deck-card").waitFor();
    await p.locator(".mrow").first().waitFor();
    await p.locator("#linkedin .li-row").first().waitFor();
    await p.locator(".owed-row").first().waitFor();
    await p.waitForTimeout(600);
    const emails = fd.outreach.filter((o) => ["draft", "manual"].includes(o.status) && o.channel !== "linkedin").length;
    check(new RegExp(`1\\s*of\\s*${emails}$`).test((await p.locator("#approve .deck-count").textContent()) ?? ""), `Today's deck counts the ${emails} emails and leaves LinkedIn and parked out (${name})`);
    check(await p.locator("#linkedin .li-list").first().locator(".li-row").count() === 3 && (await p.locator(".li-wait-head p").textContent()) === "2 waiting for connection (send a connection note)", `LinkedIn: three connected DMs, two waiting for a connection (${name})`);
    check(await p.locator('a[href^="https://claude.ai/new"]').count() === 1, `Today has one Claude hand-off with full data (${name})`);
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Today has no sideways scrolling with full data (${name})`);
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.screenshot({ path: path.join(v3, `today-send-off-${name}.png`) });
    await p.screenshot({ path: path.join(v3, `today-send-off-${name}-full.png`), fullPage: true });
    big.tables.daily_briefs = [dailyBrief(ukDay, true)];
    await p.reload();
    await p.locator(".sendline.is-on").waitFor();
    check((await p.locator(".sendline").textContent()) === "Approved emails go out at 09:53, 12:53 and 15:53.", `send_enabled true: the sending line gives the slots (${name})`);
    await p.locator("#approve .deck-card").waitFor();
    await p.locator(".mrow").first().waitFor();
    await p.waitForTimeout(500);
    check((await p.locator("#approve .deck-hint").textContent())?.includes("Approved emails go out at 09:53"), `the deck agrees when sending is on (${name})`);
    await p.screenshot({ path: path.join(v3, `today-send-on-${name}.png`) });
    await p.screenshot({ path: path.join(v3, `today-send-on-${name}-full.png`), fullPage: true });
    if (name === "phone") {
      await p.locator(".mrow").nth(0).locator(".mrow-line").click();
      await p.locator(".mrow-card .mcard").waitFor();
      await p.waitForTimeout(300);
      await p.locator("#signed-mandates").screenshot({ path: path.join(v3, "today-mandate-open-phone.png") });
    }
    big.tables.daily_briefs = [dailyBrief(ukDay)];
    // ---- Pipeline ----
    await p.goto(`${base}#/pipeline`);
    await p.locator(".pipe-row").first().waitFor();
    await p.waitForTimeout(400);
    const firstLate = (await p.locator(".pipe-row").first().locator(".pipe-late").textContent()) ?? "";
    check(/days? overdue$/.test(firstLate), `Pipeline opens on the most overdue (${name}: ${firstLate})`);
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Pipeline has no sideways scrolling with full data (${name})`);
    await p.screenshot({ path: path.join(v3, `pipeline-${name}.png`) });
    await p.screenshot({ path: path.join(v3, `pipeline-${name}-full.png`), fullPage: true });
    // ---- Leads desk (under More) ----
    await p.goto(`${base}#/leads`);
    await p.getByRole("heading", { name: "Signed mandates" }).waitFor();
    await p.locator(".lead-row").first().waitFor();
    await p.waitForTimeout(500);
    fs.mkdirSync(leadShots, { recursive: true });
    await p.screenshot({ path: path.join(leadShots, `leads-focus-${name}.png`) });
    await p.locator(".mcard").first().screenshot({ path: path.join(leadShots, `leads-card-${name}.png`) });
    check(await p.locator(".mcard").count() === 2, `the top three priorities fill two mandate cards (${name})`);
    const sup = p.locator(".mcard").nth(1);
    await p.locator("#bd .lead-row").first().waitFor();
    await sup.getByRole("button", { name: /^Open / }).click();
    check((await sup.locator(".net h4").textContent()) === "Suppliers and integrators in your network", `the supplier mandate labels its network list (${name})`);
    check((await sup.locator(".seal").textContent()) === "Not signed yet" && (await sup.locator(".mchips").textContent())?.includes("Fee letter outstanding"), `an unsigned deal says what is outstanding (${name})`);
    const quotes = new URL((await sup.getByRole("link", { name: "Ask Claude: get quotes" }).getAttribute("href")) ?? "https://x").searchParams.get("q")?.split("\n\nBefore doing anything:")[0] ?? "";
    check(quotes === "Nodus command (priority 3: Basalt): prepare an anonymised RFQ for the 100 MW BOM (no Basalt name or project details) to the best 5 integrators/suppliers in my network and new ones; draft for my approval.", `Ask Claude: get quotes has the RFQ instruction (${name})`);
    await p.getByRole("button", { name: "Show SE Wisconsin brownfield site (Project A)" }).click();
    await p.locator(".mcard").nth(2).locator(".mdeal.overdue").waitFor();
    check(true, `the fourth mandate is one tap away and its overdue deal step shows in amber (${name})`);
    await p.locator(".mcard").nth(2).screenshot({ path: path.join(focusShots, `focus-${name}-fourth.png`) });
    if (name === "phone") {
      await p.locator(".mcard").first().screenshot({ path: path.join(focusShots, "focus-phone-card1.png") });
      await sup.screenshot({ path: path.join(focusShots, "focus-phone-card2.png") });
    }
    // Outreach: parked drafts stay collapsed and read-only, with Bring back
    await p.goto(`${base}#/outreach`);
    await p.getByRole("heading", { name: "Outreach", exact: true }).waitFor();
    const parkedSum = p.locator(".parked summary");
    await parkedSum.waitFor();
    check(/Parked \(3\)/.test(await parkedSum.textContent() ?? ""), `Outreach offers a collapsed Parked (3) list (${name})`);
    check(await p.locator(".tabs a", { hasText: "To approve" }).textContent().then((t) => /\(17\)/.test(t ?? "")), `the To approve count leaves parked out (${name})`);
    await parkedSum.click();
    await p.locator(".parked-list li").first().waitFor();
    await p.waitForTimeout(300);
    await p.locator(".parked").screenshot({ path: path.join(focusShots, `outreach-parked-${name}.png`) });
    const wb = writes.length;
    await p.locator(".parked-list li").first().getByRole("button", { name: "Bring back" }).click();
    await p.getByText(/Brought back Olivia Grant/).waitFor();
    check(writes.slice(wb).some((w) => w.table === "outreach" && w.method === "PATCH" && w.body.status === "draft" && /status=eq\.parked/.test(w.url)), `Bring back sets a parked draft to draft (${name})`);
    // Opportunity: Enrich & draft
    await p.goto(`${base}#/opportunities/11111111-1111-4111-8111-111111111111`);
    const enr = p.getByRole("link", { name: "Enrich & draft" });
    await enr.waitFor();
    const eq = new URL((await enr.getAttribute("href")) ?? "https://x").searchParams.get("q")?.split("\n\nBefore doing anything:")[0] ?? "";
    check(/^Nodus command: enrich opportunity NOD-11111111 \(.+\) with decision makers \(Apollo, work emails only\) and draft first touches tied to my top priority that fits; put drafts in my console\.$/.test(eq), `Enrich & draft has the enrich instruction (${name})`);
    const rb = rpcCalls.length;
    const pop = p.waitForEvent("popup");
    await enr.click();
    await (await pop).close().catch(() => undefined);
    await p.getByText(/Marked for enrichment/).waitFor();
    check(rpcCalls.slice(rb).some((c) => c.name === "enrich_request" && c.body.p_opp === "11111111-1111-4111-8111-111111111111"), `Enrich & draft marks it through enrich_request (${name})`);
    if (name === "desktop") await p.screenshot({ path: path.join(focusShots, "opportunity-enrich-desktop.png") });
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `the opportunity page has no sideways scrolling with full data (${name})`);
    await p.goto(`${base}#/review`);
    await p.locator(".deck-card").waitFor();
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(focusShots, `review-${name}.png`), fullPage: name === "phone" });
    await p.goto(`${base}#/priorities`);
    await p.locator(".pcard").first().waitFor();
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(focusShots, `priorities-${name}.png`), fullPage: true });
    await p.goto(`${base}#/today`);
    await p.getByRole("heading", { name: "Daily report", exact: true }).waitFor();
    await p.getByRole("heading", { name: "Pipeline" }).waitFor();
    await p.waitForTimeout(900);
    await p.screenshot({ path: path.join(shots, `today-${name}.png`) });
    if (name === "desktop") await p.screenshot({ path: path.join(shots, `today-${name}-full.png`), fullPage: true });

    await p.goto(`${base}#/map`);
    await p.getByText("By region").waitFor();
    await p.waitForTimeout(3500);
    check(await p.locator(".cluster-marker").count() > 0 || await p.locator(".map-note").count() > 0, `Map clusters render (${name})`);
    await p.screenshot({ path: path.join(shots, `map-${name}.png`), fullPage: name === "phone" });
    await p.screenshot({ path: path.join(v3, `engine-map-${name}.png`) });
    const pt = await p.evaluate(() => {
      const el = document.querySelector(".mapx-canvas");
      return el ? { w: el.clientWidth, h: el.clientHeight } : null;
    });
    if (name === "desktop" && pt) {
      await p.goto(`${base}#/map?region=USA`);
      await p.waitForTimeout(2500);
      // click the busiest point under the cursor path until a panel opens
      for (const [fx2, fy2] of [[0.55, 0.45], [0.5, 0.5], [0.6, 0.4], [0.45, 0.55], [0.65, 0.5], [0.4, 0.45]]) {
        await p.mouse.click(Math.round(fx2 * 1440), Math.round(40 + fy2 * 860));
        await p.waitForTimeout(500);
        if (await p.locator(".map-panel").count()) break;
      }
      if (!(await p.locator(".map-panel").count())) {
        await p.goto(`${base}#/map?region=USA&o=${syn.opportunities.find((o) => o.country === "US" && o.region)?.id}`);
        await p.waitForTimeout(2500);
      }
      check(await p.locator(".map-panel").count() === 1, "Map opens a side panel for a point");
      await p.screenshot({ path: path.join(shots, "map-desktop-usa-panel.png") });
    }

    await p.goto(`${base}#/engine`);
    await p.locator(".engine-svg .link").first().waitFor({ state: "attached" });
    await p.waitForTimeout(1400);
    await p.screenshot({ path: path.join(shots, `engine-${name}.png`) });
    await p.screenshot({ path: path.join(v3, `engine-matches-${name}.png`) });
    const fbMatch = syn.matches.find((m) => m.explanation.feedback);
    await p.goto(`${base}#/engine?m=${fbMatch?.id ?? syn.matches[0].id}`);
    await p.getByText("Score breakdown").waitFor();
    await p.waitForTimeout(1400);
    if (name === "phone") await p.locator(".engine-panel").scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(shots, `engine-${name}-selected.png`) });

    // The opportunity sequencer: stage chips, one-click actions, Best next and the selection bars
    const foundId = syn.opportunities.find((o) => o.region && o.country === "US" && seqd.opportunity_stage.find((r) => r.opportunity_id === o.id)?.stage === "found")?.id;
    await sequencerFlow(p, { base, name, shots, check, writes, foundId });
    await p.goto(`${base}#/engine?best=1`);
    await p.locator(".engine-tabs a.active", { hasText: "Best next" }).waitFor();
    await p.waitForTimeout(900);
    await p.screenshot({ path: path.join(v3, `engine-best-${name}.png`) });

    await p.goto(`${base}#/matches`);
    await p.getByRole("heading", { name: "Matches", exact: true }).waitFor();
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(shots, `matches-${name}.png`) });
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no sideways scrolling (${name})`);
    if (process.env.SMOKE_ALL_PAGES) {
      for (const h of ["opportunities", "opportunities/11111111-1111-4111-8111-111111111111", "mandates", "deals", "contacts", "outreach", "signals", "sources", "spend", "search?q=ealing", "matches/99999999-0000-4000-8000-000000000001"]) {
        await p.goto(`${base}#/${h}`);
        await p.waitForTimeout(900);
        await p.screenshot({ path: path.join(shots, `other-${h.replace(/[/?=]/g, "_").slice(0, 40)}-${name}.png`) });
        check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no sideways scrolling on ${h} (${name})`);
      }
    }
    check(errs.length === 0, `no script errors in the ${name} screenshot pass${errs.length ? `: ${errs.join("; ")}` : ""}`);
    await c.close();
  }
} catch (e) {
  failures.push(String(e));
  console.error(e);
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `\n${failures.length} problem(s)` : `\nAll smoke checks passed. Screenshots in ${shots}`);
process.exit(failures.length ? 1 : 0);
