// The sequencer's shared pieces: the stage track, the one-click actions and the research summary.
// The same components are used on the Map, the Engine, the Opportunities list and each opportunity's page.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { copyNow } from "../lib/data.ts";
import { useLoad } from "../lib/useLoad.ts";
import { friendlyError } from "../lib/rules.ts";
import {
  DISMISS_REASONS, STAGES, STAGE_HINT, STAGE_LABEL, canWork, dismissPayload, nextStep, parseResearch, restorePayload,
  sequencerChats, stageIndex, type SeqAction, type SeqOpp, type Stage,
} from "../lib/sequencer.ts";
import { oppInfo, pipelineUpsert } from "../lib/sequencer-data.ts";
import { markWithClaude, setLocalStage, shownStage, useSeqState } from "../lib/stageStore.ts";
import { Icon } from "./Brand.tsx";
import { ExtLink } from "./ui.tsx";
import { toast } from "./Toast.tsx";
import "./sequencer.css";

// ---------- the stage track ----------

/** Seven cells, filled up to the current stage, then the stage's name. Dismissed is greyed. */
export function StageChip({ id, stage, compact = false }: { id?: string; stage: Stage; compact?: boolean }) {
  const st = useSeqState();
  const s = id ? shownStage(st, id, stage) : stage;
  const claude = id ? st.withClaude.get(id) : undefined;
  const at = stageIndex(s);
  return (
    <span className={`stage stage-${s}${compact ? " compact" : ""}`} title={`${STAGE_LABEL[s]}: ${STAGE_HINT[s]}`}>
      <span className="stage-track" aria-hidden>
        {STAGES.map((k, i) => <i key={k} className={i < at ? "done" : i === at ? "now" : ""} />)}
      </span>
      <span className="stage-name">{STAGE_LABEL[s]}</span>
      {claude && s !== "dismissed" && <span className="stage-claude" title="Handed to Claude in this browser">With Claude</span>}
    </span>
  );
}

// ---------- opening Claude ----------

function openChats(action: SeqAction, opps: SeqOpp[]) {
  const chats = sequencerChats(action, opps);
  if (chats.length === 0) return;
  const first = chats[0];
  if (!first.full) copyNow(first.text);
  markWithClaude(first.ids, action);
  const rest = chats.slice(1);
  const paste = first.full ? "" : " The instruction is on your clipboard: paste it into the new chat.";
  if (rest.length === 0) {
    toast(`With Claude: ${first.ids.length === 1 ? "1 opportunity" : `${first.ids.length} opportunities`}. Drafts come back to Review; nothing is sent until you say send.${paste}`);
    return;
  }
  toast(`Batch 1 of ${chats.length} is open (15 a chat). Open the next when you are ready.${paste}`, true, {
    ms: 60000,
    actions: rest.map((c, i) => ({
      label: `Open batch ${i + 2}`,
      close: i === rest.length - 1,
      run: () => {
        if (!c.full) copyNow(c.text);
        window.open(c.url, "_blank", "noopener,noreferrer");
        markWithClaude(c.ids, action);
      },
    })),
  });
}

/** Fills in organisation and evidence for the command when the caller only has ids and titles. */
function useFilled(opps: SeqOpp[]): SeqOpp[] {
  const missing = opps.filter((o) => o.org === undefined || o.evidence === undefined).map((o) => o.id);
  const key = missing.slice().sort().join(",");
  const { data } = useLoad(() => (missing.length ? oppInfo(missing) : Promise.resolve(new Map<string, SeqOpp>())), `info:${key}`);
  return useMemo(
    () => opps.map((o) => {
      const i = data?.get(o.id);
      return i ? { ...o, title: o.title ?? i.title, org: o.org ?? i.org, evidence: o.evidence ?? i.evidence } : o;
    }),
    [opps, data],
  );
}

function ClaudeButton({ action, opps, label, primary, small }: { action: SeqAction; opps: SeqOpp[]; label: string; primary?: boolean; small?: boolean }) {
  const chats = sequencerChats(action, opps);
  if (chats.length === 0) return null;
  return (
    <a
      className={`btn${primary ? " primary" : ""}${small ? " small" : ""}`}
      href={chats[0].url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => openChats(action, opps)}
      data-action={action}
    >
      <Icon.claude />{label}
    </a>
  );
}

// ---------- dismiss ----------

async function dismiss(opps: { id: string; stage: Stage }[], reason: string, onChanged?: () => void) {
  const prev = new Map(opps.map((o) => [o.id, o.stage] as const));
  setLocalStage(opps.map((o) => [o.id, "dismissed"]));
  try {
    await pipelineUpsert(dismissPayload(opps.map((o) => o.id), reason));
  } catch (e) {
    setLocalStage(opps.map((o) => [o.id, null]));
    toast(`Not dismissed: ${friendlyError(e)}`, false);
    return;
  }
  onChanged?.();
  const n = opps.length;
  toast(`Dismissed ${n === 1 ? "1 opportunity" : `${n} opportunities`}: ${reason.toLowerCase()}.`, true, {
    ms: 9000,
    actions: [{ label: "Undo", primary: true, run: () => void restore(prev, onChanged) }],
  });
}

async function restore(prev: Map<string, Stage>, onChanged?: () => void) {
  setLocalStage([...prev.entries()]);
  try {
    await pipelineUpsert(restorePayload(prev));
    toast("Undone.");
    onChanged?.();
  } catch (e) {
    toast(`Could not undo: ${friendlyError(e)}`, false);
  }
}

function DismissControl({ opps, label, small, onChanged }: { opps: { id: string; stage: Stage }[]; label: string; small?: boolean; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`seq-dismiss${open ? " open" : ""}`}>
      <button type="button" className={`btn ghost${small ? " small" : ""}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      {open && (
        <span className="seq-reasons" role="group" aria-label="Why dismiss">
          {DISMISS_REASONS.map((r) => (
            <button key={r} type="button" className="seq-reason" onClick={() => { setOpen(false); void dismiss(opps, r, onChanged); }}>
              {r}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

// ---------- the actions ----------

/**
 * One opportunity: Work it (to drafted), the next step, Dismiss.
 * Several (bulk): Work N, Research N, Dismiss N.
 */
export function SeqActions({ opps, bulk = false, small = false, onChanged }: { opps: SeqOpp[]; bulk?: boolean; small?: boolean; onChanged?: () => void }) {
  const st = useSeqState();
  const filled = useFilled(opps);
  const withStage = filled.map((o) => ({ ...o, stage: shownStage(st, o.id, o.stage) }));
  if (withStage.length === 0) return null;

  if (bulk || withStage.length > 1) {
    const live = withStage.filter((o) => o.stage !== "dismissed");
    const workable = live.filter((o) => canWork(o.stage));
    const found = live.filter((o) => o.stage === "found");
    const n = live.length;
    return (
      <div className="seq-actions bulk">
        {workable.length > 0 && <ClaudeButton action="work" opps={workable} label={`Work ${workable.length} selected`} primary small={small} />}
        {found.length > 0 && <ClaudeButton action="research" opps={found} label={`Research ${found.length}`} small={small} />}
        {n > 0 && <DismissControl opps={live} label={`Dismiss ${n}`} small={small} onChanged={onChanged} />}
      </div>
    );
  }

  const o = withStage[0];
  const next = nextStep(o.stage);
  const work = canWork(o.stage);
  let nextEl: React.ReactNode = null;
  if (next.kind === "claude") {
    nextEl = <ClaudeButton action={next.action} opps={[o]} label={next.label} primary={!work} small={small} />;
  } else if (next.kind === "review") {
    nextEl = <Link className={`btn primary${small ? " small" : ""}`} to={`/review?opp=${o.id}`}><Icon.review />{next.label}</Link>;
  } else if (next.kind === "deal") {
    nextEl = <Link className={`btn primary${small ? " small" : ""}`} to="/deals"><Icon.deals />{next.label}</Link>;
  } else if (next.kind === "restore") {
    nextEl = (
      <button type="button" className={`btn${small ? " small" : ""}`} onClick={() => void restore(new Map([[o.id, "found"]]), onChanged)}>
        {next.label}
      </button>
    );
  }
  return (
    <div className="seq-actions">
      {work && <ClaudeButton action="work" opps={[o]} label="Work it" primary small={small} />}
      {nextEl}
      {o.stage !== "dismissed" && <DismissControl opps={[o]} label="Dismiss" small={small} onChanged={onChanged} />}
    </div>
  );
}

/** A short line under the buttons saying what "Work it" does, for the bigger panels. */
export function SeqHint() {
  return <p className="seq-hint">Work it runs research, people and drafts in one Claude chat, then stops for your send. Nothing goes out without you.</p>;
}

// ---------- research ----------

export function ResearchPanel({ research, nextAction }: { research: unknown; nextAction?: string | null }) {
  const r = parseResearch(research);
  if (!r && !nextAction) return null;
  const rows: [string, string | null][] = r
    ? [["What they need", r.what_they_need], ["Value exchange", r.value_exchange], ["Angle", r.angle], ["Risks", r.risks]]
    : [];
  return (
    <section className="research" aria-label="Research">
      <h4>Research</h4>
      {r?.summary && <p className="research-sum">{r.summary}</p>}
      <dl>
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
        {nextAction && <div><dt>Next action</dt><dd>{nextAction}</dd></div>}
      </dl>
      {r && r.sources.length > 0 && (
        <details>
          <summary>Sources ({r.sources.length})</summary>
          <ul>{r.sources.map((u) => <li key={u}><ExtLink url={u}>{hostOf(u)}</ExtLink></li>)}</ul>
        </details>
      )}
    </section>
  );
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

// ---------- selection bar ----------

export function SelectionBar({ opps, onClear, onChanged, note }: { opps: SeqOpp[]; onClear: () => void; onChanged?: () => void; note?: string }) {
  if (opps.length === 0) return null;
  const over = opps.length > 15 ? ` Split into ${Math.ceil(opps.length / 15)} chats of up to 15.` : "";
  return (
    <div className="seq-bar" role="region" aria-label="Selected opportunities">
      <div className="seq-bar-what">
        <span className="seq-bar-top"><b>{opps.length} selected</b><button type="button" className="link-btn" onClick={onClear}>Clear</button></span>
        <span>{note ?? "Claude takes them from their current stage."}{over}</span>
      </div>
      <SeqActions opps={opps} bulk small onChanged={() => { onClear(); onChanged?.(); }} />
    </div>
  );
}
