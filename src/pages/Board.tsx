import { useMemo, useState, type FormEvent } from "react";
import { boardLoad, findRequestAdd, matchDecide, matchNotFit } from "../lib/data.ts";
import { useLoad } from "../lib/useLoad.ts";
import { fmtNumber } from "../lib/format.ts";
import { friendlyError } from "../lib/rules.ts";
import type { BoardRow, BoardSide } from "../lib/types.ts";
import { EngineTabs } from "../components/EngineTabs.tsx";
import { AskClaude } from "../components/PriorityCard.tsx";
import { Icon } from "../components/Brand.tsx";
import { toast } from "../components/Toast.tsx";
import { Empty, ErrorBox, Loading, PageHead, useTitle } from "../components/ui.tsx";

const QUICK = [
  "Capital partners for Al-Risha",
  "Offtakers for 70 MW MENA",
  "Neoclouds short of capacity",
  "Sites for powered-shell buyers",
  "GPU supply + financing",
];
const FIRST = 30;
const TIER_LABEL: Record<string, string> = { heaven: "Heaven", strong: "Strong" };
const PAIR_LABEL: Record<string, string> = { capital: "Capital", offtake: "Offtake", compute: "Compute", equipment: "Equipment", land: "Land", power: "Power" };
const pairLabel = (p: string | null) => (p ? PAIR_LABEL[p] ?? p.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Other");

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** Same organisation on both sides (e.g. a site card matched to its own need): not a match worth showing. */
export function isSelfPair(r: Pick<BoardRow, "need_side" | "supply_side">): boolean {
  const a = norm(r.need_side?.name);
  return a !== "" && a === norm(r.supply_side?.name);
}

function sideText(s: BoardSide | null): string {
  if (!s) return "";
  return [s.name, s.what].filter(Boolean).join(": ") + (s.size ? ` (${s.size})` : "");
}

/** The Claude hand-off for one match: check what exists, name the person on the side we don't hold, draft the first touch. */
export function workPrompt(r: BoardRow): string {
  const need = sideText(r.need_side) || "unknown";
  const supply = sideText(r.supply_side) || "unknown";
  const fin = r.financing ? `\nFinancing: ${sideText(r.financing)}` : "";
  return (
    `Nodus command (Board: work this match, match_id ${r.match_id}; ${TIER_LABEL[r.tier ?? ""] ?? r.tier} ${Number(r.score ?? 0).toFixed(0)}; ` +
    `${pairLabel(r.pair_type)}; mandate ${r.mandate_code ?? "none"}).\n` +
    `Need: ${need}\nSupply: ${supply}${fin}\nWhy: ${(r.why ?? "").trim() || "see match_board"}\n\n` +
    "1. Check the CRM (crm_contacts, deals, crm_actions) and the full outreach history for both sides first; build on what exists and never duplicate a message.\n" +
    "2. Name the decision maker on the side we don't hold (role, why them, source).\n" +
    "3. Draft the first touch per OUTBOUND-PROMPT v3 (capital: relationship-first with the mandate range and a light close; power and compute: direct; procurement: RFQ). " +
    "Email first into the console for my approval; LinkedIn only if they are a 1st-degree connection, and I send it myself.\n" +
    "No names across sides before Protected (NCNDA + fee protection). Never mention fees."
  );
}

/**
 * Engine → Board: the Heaven and Strong matches from match_board, Heaven first. Each card says need ↔ supply
 * (+ financing), why, the pair type and the mandate code, with "Work this match" (one Claude chat) and "Not a fit".
 * A Find bar on top queues a plain-English search for the next engine run, or runs it now with Claude.
 */
export default function Board() {
  useTitle("Board");
  const { data, error, loading, reload } = useLoad(boardLoad, "board");
  const [pair, setPair] = useState<string | null>(null);
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [all, setAll] = useState(false);

  const rows = useMemo(() => (data ?? []).filter((r) => !isSelfPair(r) && !gone.has(r.match_id)), [data, gone]);
  const pairs = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.pair_type ?? "", (m.get(r.pair_type ?? "") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const shown = rows.filter((r) => pair === null || (r.pair_type ?? "") === pair);
  const byScore = (a: BoardRow, b: BoardRow) => Number(b.score ?? 0) - Number(a.score ?? 0);
  const heaven = shown.filter((r) => r.tier === "heaven").sort(byScore);
  const strong = shown.filter((r) => r.tier !== "heaven").sort(byScore);
  const strongShown = all ? strong : strong.slice(0, Math.max(0, FIRST - heaven.length));

  const notFit = async (r: BoardRow) => {
    setGone((g) => new Set(g).add(r.match_id));
    const back = () => setGone((g) => { const n = new Set(g); n.delete(r.match_id); return n; });
    try {
      await matchNotFit(r.match_id);
      toast(`Marked not a fit: ${r.need_side?.name ?? "need"} ↔ ${r.supply_side?.name ?? "supply"}.`, true, {
        ms: 8000,
        actions: [{
          label: "Undo",
          primary: true,
          run: () => void matchDecide(r.match_id, "reopen").then(() => { back(); toast("Back on the board."); }, (e) => toast(friendlyError(e), false)),
        }],
      });
    } catch (e) {
      back();
      toast(friendlyError(e), false);
    }
  };

  return (
    <div className="stack-lg">
      <PageHead eyebrow="Matchmaking engine" title="Engine" actions={<EngineTabs />}>
        The best pairings the engine has found: Heaven first, then Strong. Work one with Claude, or mark it not a fit.
      </PageHead>

      <FindBar />

      {error && !data ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading what="Getting the board…" />
      ) : rows.length === 0 ? (
        <Empty>No Heaven or Strong matches on active mandates yet. Queue a Find above, or check back after the next engine run.</Empty>
      ) : (
        <>
          <div className="chips board-filter" role="group" aria-label="Pair type">
            <button type="button" className="chip" aria-pressed={pair === null} onClick={() => setPair(null)}>All <strong>{fmtNumber(rows.length)}</strong></button>
            {pairs.map(([p, n]) => (
              <button key={p} type="button" className="chip" aria-pressed={pair === p} onClick={() => setPair(pair === p ? null : p)}>
                {pairLabel(p || null)} <strong>{fmtNumber(n)}</strong>
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <Empty>No matches of this type.</Empty>
          ) : (
            <>
              {heaven.length > 0 && <TierBlock tier="heaven" rows={heaven} onNotFit={notFit} />}
              {strong.length > 0 && <TierBlock tier="strong" rows={strongShown} total={strong.length} onNotFit={notFit} />}
              {strongShown.length < strong.length && (
                <button type="button" className="padd" onClick={() => setAll(true)}>Show all {fmtNumber(strong.length)} Strong</button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function TierBlock({ tier, rows, total, onNotFit }: { tier: string; rows: BoardRow[]; total?: number; onNotFit: (r: BoardRow) => void }) {
  return (
    <section className="stack" aria-labelledby={`h-${tier}`}>
      <div className="today-sec">
        <h2 id={`h-${tier}`}>{TIER_LABEL[tier] ?? tier}</h2>
        <span className="muted small">{fmtNumber(total ?? rows.length)} {(total ?? rows.length) === 1 ? "match" : "matches"}{tier === "heaven" ? ", 85 and up" : ", 70 to 84"}</span>
      </div>
      <ul className="board-list">
        {rows.map((r) => <BoardCard key={r.match_id} r={r} onNotFit={() => onNotFit(r)} />)}
      </ul>
    </section>
  );
}

function Side({ tag, s }: { tag: string; s: BoardSide | null }) {
  if (!s) return null;
  return (
    <div className="board-side">
      <span className="side-tag">{tag}</span>
      <strong>{s.name || "Unnamed"}</strong>
      {s.what && <span className="board-what">{s.what}</span>}
      {(s.size || s.region) && <span className="muted small">{[s.size, s.region].filter(Boolean).join(" · ")}</span>}
    </div>
  );
}

function BoardCard({ r, onNotFit }: { r: BoardRow; onNotFit: () => void }) {
  const score = Number(r.score ?? 0);
  return (
    <li className={`card board-card tier-${r.tier ?? "strong"}`}>
      <div className="board-head">
        <span className={`pill ${r.tier === "heaven" ? "pill-good" : "pill-wait"}`}>{TIER_LABEL[r.tier ?? ""] ?? r.tier} {Number.isFinite(score) ? score.toFixed(0) : "–"}</span>
        <span className="badge">{pairLabel(r.pair_type)}</span>
        {r.mandate_code && <span className="badge">{r.mandate_code}</span>}
      </div>
      <div className="board-pair">
        <Side tag="Need" s={r.need_side} />
        <span className="board-arrow" aria-label="matched with">↔</span>
        <Side tag="Supply" s={r.supply_side} />
        {r.financing && (<><span className="board-arrow" aria-label="plus financing">+</span><Side tag="Financing" s={r.financing} /></>)}
      </div>
      {r.why && <p className="board-why">{r.why.trim().replace(/[;,]\s*$/, "")}</p>}
      <div className="action-row">
        <AskClaude className="btn primary small" prompt={workPrompt(r)}><Icon.claude />Work this match</AskClaude>
        <button type="button" className="btn small ghost" onClick={onNotFit}>Not a fit</button>
      </div>
    </li>
  );
}

function FindBar() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState<{ id: string; query: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (text: string) => {
    const query = text.trim();
    if (!query || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const id = await findRequestAdd(query);
      setQueued({ id, query });
      setQ("");
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(q);
  };

  return (
    <section className="card board-find" aria-label="Find">
      <form className="board-find-form" onSubmit={onSubmit} role="search">
        <label className="field grow">
          <span>Find</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Who needs what? e.g. capital partners for Al-Risha" maxLength={300} aria-label="Find in plain English" />
        </label>
        <button className="btn primary" type="submit" disabled={busy || !q.trim()}>{busy ? "Queuing…" : "Find"}</button>
      </form>
      <div className="chips">
        {QUICK.map((t) => (
          <button key={t} type="button" className="chip" disabled={busy} onClick={() => void submit(t)}>{t}</button>
        ))}
      </div>
      {err && <p className="error small" role="alert">{err}</p>}
      {queued && (
        <div className="board-queued" role="status">
          <p className="ok small">Queued — results appear on the board after the next engine run.</p>
          <AskClaude className="btn small" prompt={`Run Find: "${queued.query}" (find_requests id ${queued.id}) per ORIGINATION-PROMPT via scripts/bridge.sh find`}>
            <Icon.claude />Run it now with Claude
          </AskClaude>
        </div>
      )}
    </section>
  );
}
