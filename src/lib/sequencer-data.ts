// Database calls for the sequencer: live stages (opportunity_stage), Kuran's own changes (opportunity_pipeline)
// and the ranked queue of unworked opportunities (bd_queue).
import { supabase, must } from "./supabase.ts";
import { parseStage, type PipelineRow, type SeqOpp, type Stage } from "./sequencer.ts";

export interface StageRow {
  opportunity_id: string;
  stage: Stage;
  research: unknown;
  next_action: string | null;
  dismissed_reason: string | null;
  updated_at: string | null;
}

const PAGE = 1000;

/** Every opportunity's live stage (no research, to keep it light). Empty map if the view cannot be read. */
export async function stagesAll(cap = 20000): Promise<Map<string, Stage>> {
  const out = new Map<string, Stage>();
  try {
    for (let from = 0; from < cap; from += PAGE) {
      const res = await supabase.from("opportunity_stage").select("opportunity_id,stage").order("opportunity_id").range(from, from + PAGE - 1);
      if (res.error) throw res.error;
      const rows = (res.data ?? []) as { opportunity_id: string; stage: string }[];
      for (const r of rows) out.set(r.opportunity_id, parseStage(r.stage));
      if (rows.length < PAGE) break;
    }
  } catch (e) {
    console.warn("opportunity_stage not readable:", e);
  }
  return out;
}

/** Stages for a handful of opportunities (chunked so the address stays short). */
export async function stagesFor(ids: string[]): Promise<Map<string, Stage>> {
  const out = new Map<string, Stage>();
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 150) {
    const chunk = uniq.slice(i, i + 150);
    const res = await supabase.from("opportunity_stage").select("opportunity_id,stage").in("opportunity_id", chunk);
    if (res.error) {
      console.warn("opportunity_stage not readable:", res.error.message);
      return out;
    }
    for (const r of (res.data ?? []) as { opportunity_id: string; stage: string }[]) if (chunk.includes(r.opportunity_id)) out.set(r.opportunity_id, parseStage(r.stage));
  }
  return out;
}

/** One opportunity's stage with its research. */
export async function stageOne(id: string): Promise<StageRow | null> {
  const res = await supabase.from("opportunity_stage").select("opportunity_id,stage,research,next_action,dismissed_reason,updated_at").eq("opportunity_id", id);
  if (res.error) {
    console.warn("opportunity_stage not readable:", res.error.message);
    return null;
  }
  const rows = (res.data ?? []) as Record<string, unknown>[];
  const r = rows.find((x) => x.opportunity_id === id);
  if (!r) return null;
  return {
    opportunity_id: id,
    stage: parseStage(r.stage),
    research: r.research ?? null,
    next_action: (r.next_action as string | null) ?? null,
    dismissed_reason: (r.dismissed_reason as string | null) ?? null,
    updated_at: (r.updated_at as string | null) ?? null,
  };
}

/** Insert or update Kuran's stage rows (one per opportunity). */
export async function pipelineUpsert(rows: PipelineRow[]): Promise<void> {
  if (rows.length === 0) return;
  must(await supabase.from("opportunity_pipeline").upsert(rows, { onConflict: "opportunity_id" }).select("opportunity_id"));
}

interface InfoRow {
  id: string;
  title: string | null;
  organisations: { legal_name: string | null } | null;
  opportunity_signals: { signals: { source_url: string | null } | null }[] | null;
}

/** Title, organisation and first evidence link for each opportunity, for the Claude command. */
export async function oppInfo(ids: string[]): Promise<Map<string, SeqOpp>> {
  const out = new Map<string, SeqOpp>();
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100);
    const res = await supabase
      .from("opportunities")
      .select("id,title,organisations(legal_name),opportunity_signals(signals(source_url))")
      .in("id", chunk);
    if (res.error) {
      console.warn("opportunity details not readable:", res.error.message);
      return out;
    }
    for (const r of (res.data ?? []) as unknown as InfoRow[]) {
      if (!chunk.includes(r.id)) continue;
      const ev = (r.opportunity_signals ?? []).map((s) => s.signals?.source_url).find((u) => Boolean(u)) ?? null;
      out.set(r.id, { id: r.id, title: r.title, org: r.organisations?.legal_name ?? null, evidence: ev });
    }
  }
  return out;
}

export interface BestRow {
  opportunity_id: string;
  line: string;
  side: string;
  title: string;
  country: string | null;
  mw: number | null;
  legal_name: string | null;
  evidence_url: string | null;
  tier: "A" | "B" | string;
  bd_score: number | string | null;
  suggested_priority_id: string | null;
  /** Filled in here: the suggested priority's rank and title. */
  priority: { rank: number; title: string } | null;
  stage: Stage;
}

const BEST_COLS = "opportunity_id,line,side,title,country,mw,legal_name,evidence_url,tier,bd_score,suggested_priority_id";

/** The top of bd_queue: tier A (routed to a mandate) first, then by score. */
export async function bestNext(limit = 20): Promise<BestRow[]> {
  const rows = must(
    await supabase.from("bd_queue").select(BEST_COLS).order("tier", { ascending: true }).order("bd_score", { ascending: false }).limit(limit),
  ) as unknown as Omit<BestRow, "priority" | "stage">[];
  const sorted = [...rows].sort((a, b) => String(a.tier).localeCompare(String(b.tier)) || Number(b.bd_score) - Number(a.bd_score)).slice(0, limit);
  const pids = [...new Set(sorted.map((r) => r.suggested_priority_id).filter(Boolean))] as string[];
  const [prios, stages] = await Promise.all([
    pids.length
      ? supabase.from("priorities").select("id,rank,title").in("id", pids).then((r) => (r.error ? [] : ((r.data ?? []) as { id: string; rank: number; title: string }[])))
      : Promise.resolve([]),
    stagesFor(sorted.map((r) => r.opportunity_id)),
  ]);
  const pmap = new Map(prios.map((p) => [p.id, p]));
  return sorted.map((r) => {
    const p = r.suggested_priority_id ? pmap.get(r.suggested_priority_id) : undefined;
    return { ...r, priority: p ? { rank: p.rank, title: p.title } : null, stage: stages.get(r.opportunity_id) ?? "found" };
  });
}
