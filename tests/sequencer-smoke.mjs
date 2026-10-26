// Smoke checks for the opportunity sequencer (Map, Engine, Best next, Opportunities, Review), run from smoke.mjs
// inside its full-data pass so it shares the fake Supabase. Screenshots go to SEQ_SHOTS (or the main folder).
import path from "node:path";
import fs from "node:fs";
import { RESEARCHED_ID } from "./fixtures/sequencer.mjs";

const PROJECT = "01a0f3c4-b60e-7236-8dea-4bd5402220f3";
const q = (href) => {
  try {
    const u = new URL(href ?? "https://x");
    return { q: u.searchParams.get("q") ?? "", project: u.searchParams.get("project") };
  } catch {
    return { q: "", project: null };
  }
};

export async function sequencerFlow(p, { base, name, shots, check, writes, foundId }) {
  const dir = process.env.SEQ_SHOTS || shots;
  fs.mkdirSync(dir, { recursive: true });
  const at = (s) => `${s} (${name})`;
  const desk = name === "desktop";

  // ---- Map: the side panel shows the stage and the one-click actions ----
  await p.goto(`${base}#/map?o=${foundId}`);
  const panel = p.locator(".map-panel");
  await panel.waitFor();
  await panel.locator(".stage").first().waitFor();
  check((await panel.locator(".stage-name").first().textContent()) === "Found", at("Map panel shows the stage chip (Found)"));
  const work = panel.getByRole("link", { name: "Work it" });
  const wq = q(await work.getAttribute("href"));
  check(wq.project === PROJECT && wq.q.startsWith("Nodus command (opportunity sequencer: Work it): take this opportunity to drafted.") &&
    wq.q.includes(`| opportunity_id ${foundId} |`) && wq.q.includes('section "Opportunity sequencer": run every stage from the current one up to drafted') &&
    wq.q.includes("Before doing anything:"), at("Work it opens one Nodus chat with the sequencer command and the check-first line"));
  const rq = q(await panel.getByRole("link", { name: "Research it" }).getAttribute("href"));
  check(rq.q.includes("run only the research step"), at("Research it runs only the research step"));
  const pop = p.waitForEvent("popup");
  await work.click();
  await (await pop).close().catch(() => undefined);
  await panel.locator(".stage-claude").waitFor();
  check(await panel.locator(".stage-claude").textContent() === "With Claude", at("after opening, the opportunity shows With Claude"));

  // Dismiss with a one-tap reason, then Undo
  let w0 = writes.length;
  await panel.getByRole("button", { name: "Dismiss" }).click();
  await panel.getByRole("button", { name: "Broker chain" }).click();
  await p.getByText("Dismissed 1 opportunity: broker chain.").waitFor();
  const dw = writes.slice(w0).find((w) => w.table === "opportunity_pipeline" && w.method === "POST");
  const row = Array.isArray(dw?.body) ? dw.body[0] : dw?.body;
  check(Boolean(dw) && /on_conflict=opportunity_id/.test(dw.url) && row?.opportunity_id === foundId && row?.stage === "dismissed" && row?.dismissed_reason === "Broker chain",
    at("Dismiss upserts opportunity_pipeline with stage dismissed and the reason"));
  check((await panel.locator(".stage-name").first().textContent()) === "Dismissed", at("the panel shows Dismissed at once"));
  w0 = writes.length;
  await p.locator(".toast").getByRole("button", { name: "Undo" }).click();
  await p.getByText("Undone.").waitFor();
  const uw = writes.slice(w0).find((w) => w.table === "opportunity_pipeline" && w.method === "POST");
  const urow = Array.isArray(uw?.body) ? uw.body[0] : uw?.body;
  check(urow?.stage === "found" && urow?.dismissed_reason === null, at("Undo puts the stage back"));

  // A researched opportunity shows its research and the next step
  await p.goto(`${base}#/map?o=${RESEARCHED_ID}`);
  await p.locator(".map-panel .research").waitFor();
  check((await p.locator(".map-panel .research-sum").textContent())?.startsWith("A 40 MW gas-fired site") && await p.locator(".map-panel").getByRole("link", { name: "Find the people" }).count() === 1,
    at("research shows in the Map panel with Find the people next"));
  if (desk) await p.waitForTimeout(1600);
  await p.screenshot({ path: path.join(dir, `seq-map-panel-${name}.png`) });

  // The list tab: tick several, the selection bar appears
  await p.goto(`${base}#/map`);
  await p.getByRole("button", { name: /^List \(/ }).click();
  const boxes = p.locator(".map-legend .seq-row input[type=checkbox]");
  await boxes.first().waitFor();
  const n = desk ? 18 : 3;
  // from the bottom of the list, where the unworked (found) ones are
  const total = await boxes.count();
  for (let i = 0; i < n; i++) await boxes.nth(total - 1 - i).check();
  const bar = p.locator(".seq-bar");
  await bar.waitFor();
  check((await bar.textContent())?.includes(`${n} selected`) && await bar.getByRole("button", { name: `Dismiss ${n}` }).count() === 1, at("ticking in the Map list opens the selection bar"));
  if (desk) {
    check((await bar.textContent())?.includes("Split into 2 chats"), at("more than 15 selected is split into chats of 15"));
    const research = bar.getByRole("link", { name: /^Research \d+$/ });
    const k = Number(((await research.textContent()) ?? "").replace(/\D+/g, ""));
    const pop2 = p.waitForEvent("popup");
    await research.click();
    await (await pop2).close().catch(() => undefined);
    if (k > 15) {
      await p.getByText(/Batch 1 of 2 is open/).waitFor();
      check(await p.locator(".toast").getByRole("button", { name: "Open batch 2" }).count() === 1, at("the second batch is one tap away"));
    } else {
      await p.getByText(/With Claude:/).waitFor();
      check(true, at("Research N opens a chat"));
    }
    await p.waitForTimeout(400);
  }
  await p.waitForTimeout(desk ? 1200 : 400);
  await p.screenshot({ path: path.join(dir, `seq-map-list-${name}.png`), fullPage: !desk });

  // ---- Engine: Best to work next ----
  await p.goto(`${base}#/engine?best=1`);
  await p.locator(".best-row").first().waitFor();
  check(await p.locator(".best-row").count() === 20, at("Best to work next lists the top 20"));
  const first = p.locator(".best-row").first();
  check((await first.locator(".best-tier").textContent()) === "Routed" && (await first.locator(".best-why").textContent())?.startsWith("Fits priority"), at("routed ones come first, with the priority they fit"));
  check(await first.locator(".stage").count() === 1 && await first.getByRole("link", { name: "Work it" }).count() === 1, at("each row has a stage and Work it"));
  await p.locator(".best-row").nth(1).locator("input[type=checkbox]").check();
  await p.locator(".best-row").nth(2).locator("input[type=checkbox]").check();
  const ebar = p.locator(".seq-bar");
  await ebar.waitFor();
  const bq = q(await ebar.getByRole("link", { name: /^Work \d+ selected$/ }).getAttribute("href"));
  check(bq.q.startsWith("Nodus command (opportunity sequencer: Work it): take these 2 opportunities to drafted.") && (bq.q.match(/\| opportunity_id /g) ?? []).length === 2 && bq.q.includes("| org Fictional"),
    at("Work 2 selected sends both, with organisation and evidence from bd_queue"));
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(dir, `seq-engine-best-${name}.png`), fullPage: !desk });
  if (!desk) await p.screenshot({ path: path.join(dir, `seq-engine-best-${name}-view.png`) });

  // ---- Engine board: tick on the right, stage in the selected match ----
  await p.goto(`${base}#/engine`);
  await p.locator(".engine-svg .link").first().waitFor({ state: "attached" });
  const pick = p.locator(".engine-svg [role=checkbox]");
  check(await pick.count() > 0, at("the Engine's opportunity column has tick boxes"));
  await pick.nth(0).click();
  await pick.nth(1).click();
  await p.locator(".seq-bar").waitFor();
  check((await p.locator(".seq-bar").textContent())?.includes("2 selected"), at("ticking two on the board opens the bar"));
  await p.locator(".engine-rank button").first().click();
  await p.locator(".side-seq").first().waitFor();
  check(await p.locator(".side-seq .stage").count() >= 1 && await p.locator(".side-seq .seq-actions").count() >= 1, at("the selected match shows each side's stage and actions"));
  await p.waitForTimeout(1300);
  await p.screenshot({ path: path.join(dir, `seq-engine-board-${name}.png`) });
  if (!desk) {
    await p.locator(".engine-panel").scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(dir, `seq-engine-selected-${name}.png`) });
  }

  // ---- Opportunities list and detail ----
  await p.goto(`${base}#/opportunities`);
  await p.locator("td[data-label=Stage] .stage").first().waitFor();
  check(true, at("the Opportunities list shows a stage on each row"));
  await p.goto(`${base}#/opportunities/${RESEARCHED_ID}`);
  await p.locator(".seq-block .research").waitFor();
  check(await p.getByRole("link", { name: "Find the people" }).count() === 1, at("the opportunity page shows research and the next step"));
  if (desk) await p.screenshot({ path: path.join(dir, `seq-opportunity-${name}.png`) });

  // ---- Review filtered to one opportunity ----
  await p.goto(`${base}#/review?opp=${foundId}`);
  await p.getByText("Drafts for one opportunity.").waitFor();
  check(true, at("Review & send opens Review for that opportunity"));
  check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), at("no sideways scrolling on the sequencer pages"));
}
