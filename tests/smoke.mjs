// Browser smoke test: serves dist/ like GitHub Pages (under /nodus-console/), answers every call to
// Supabase with fixture JSON shaped like the real tables and functions, and checks the main pages render.
// Needs Playwright with Chromium already installed. Usage: npm run build && npm run smoke [-- <screenshot dir>]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { synthetic } from "./fixtures/synthetic.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../dist");
const shots = process.argv[2] || process.env.SHOTS_DIR || path.resolve(here, "../.smoke");
const fx = JSON.parse(fs.readFileSync(path.join(here, "fixtures/fixtures.json"), "utf8"));
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
    if (idEq?.startsWith("eq.")) rows = rows.filter((r) => r.id === idEq.slice(3));
    const lineEq = u.searchParams.get("line");
    if (lineEq?.startsWith("eq.")) rows = rows.filter((r) => r.line === lineEq.slice(3));
    const statusEq = u.searchParams.get("status");
    if (statusEq?.startsWith("eq.")) rows = rows.filter((r) => r.status === statusEq.slice(3));
    if (statusEq?.startsWith("in.(")) { const set = statusEq.slice(4, -1).split(","); rows = rows.filter((r) => !r.status || set.includes(r.status)); }
    if (req.method() === "PATCH") { writes.push({ table, url: u.search, body: req.postDataJSON?.() ?? {} }); return json(200, rows.slice(0, 1)); }
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

  await page.getByRole("heading", { name: "Today" }).waitFor();
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
  await page.goto(base);
  await page.getByRole("heading", { name: "Approve (1)" }).waitFor();
  check(await page.locator(".nav-count").first().textContent() === "1", "Today shows a drafts badge in the nav");
  check(await page.getByRole("heading", { name: "LinkedIn to send (1)" }).isVisible(), "Today lists LinkedIn to send");
  check(await page.getByText("Chase the NCNDA").isVisible(), "Today lists actions to do first");
  check(await page.getByRole("link", { name: "Example 20 MW gensets" }).isVisible(), "Today lists deals due");
  await page.screenshot({ path: path.join(shots, "console-today-crm.png"), fullPage: false });
  await page.locator(".outreach textarea").first().fill("Hello Alex,\nEdited.");
  await page.getByRole("button", { name: "Save edit" }).click();
  await page.getByText("Edit saved.").waitFor();
  check(rpcCalls.some((c) => c.name === "outreach_decide" && c.body.p_decision === "edit" && c.body.p_body === "Hello Alex,\nEdited."), "Save edit calls outreach_decide with the new text");
  await page.getByRole("button", { name: "Approve", exact: true }).first().click();
  await page.getByText("Approved. The send job").waitFor();
  check(rpcCalls.some((c) => c.name === "outreach_decide" && c.body.p_decision === "approve"), "Approve calls outreach_decide");
  await page.getByRole("button", { name: "Mark sent" }).click();
  await page.waitForTimeout(300);
  check(writes.some((w) => w.table === "outreach" && w.body.status === "sent" && w.body.sent_at), "Mark sent sets status sent and sent_at");
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
  await page.getByRole("button", { name: "UK" }).click();
  check(/region=UK/.test(page.url()), "Map region filter is kept in the address");
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Map has no sideways scrolling at phone width");

  await page.goto(`${base}#/engine`);
  await page.getByRole("heading", { name: "Engine", exact: true }).waitFor();
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
  }

  // ---------- screenshots with fuller fake data: desktop 1440 and phone 390 ----------
  const syn = synthetic();
  const big = {
    ...fx,
    tables: {
      ...fx.tables,
      opportunities: [...fx.tables.opportunities, ...syn.opportunities],
      v_match_cards: [...fx.tables.v_match_cards, ...syn.matches],
      matches: syn.matches.map((m) => ({ id: m.id, status: m.status, total_score: m.total_score, supply_opportunity_id: m.supply_id, need_opportunity_id: m.need_id })),
      mandates: [...fx.tables.mandates, ...syn.mandates],
      deals: [...fx.tables.deals, ...syn.deals],
      connector_runs: [{ finished_at: new Date(Date.now() - 5 * 3600e3).toISOString() }],
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
    await p.goto(base);
    await p.getByRole("heading", { name: "Today", exact: true }).waitFor();
    await p.getByRole("heading", { name: "Pipeline" }).waitFor();
    await p.waitForTimeout(900);
    await p.screenshot({ path: path.join(shots, `today-${name}.png`) });
    if (name === "desktop") await p.screenshot({ path: path.join(shots, `today-${name}-full.png`), fullPage: true });

    await p.goto(`${base}#/map`);
    await p.getByText("By region").waitFor();
    await p.waitForTimeout(3500);
    check(await p.locator(".cluster-marker").count() > 0 || await p.locator(".map-note").count() > 0, `Map clusters render (${name})`);
    await p.screenshot({ path: path.join(shots, `map-${name}.png`), fullPage: name === "phone" });
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
    const fbMatch = syn.matches.find((m) => m.explanation.feedback);
    await p.goto(`${base}#/engine?m=${fbMatch?.id ?? syn.matches[0].id}`);
    await p.getByText("Score breakdown").waitFor();
    await p.waitForTimeout(1400);
    if (name === "phone") await p.locator(".engine-panel").scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(shots, `engine-${name}-selected.png`) });

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
