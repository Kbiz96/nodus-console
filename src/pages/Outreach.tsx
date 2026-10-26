import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase, must, mustCount } from "../lib/supabase.ts";
import { useLoad } from "../lib/useLoad.ts";
import { OUTREACH_STATUSES, OUTREACH_STATUS_LABEL } from "../lib/crm.ts";
import { fmtDateTime, fmtNumber, truncate } from "../lib/format.ts";
import { outreachChanged, outreachUnpark } from "../lib/data.ts";
import { PARKED } from "../lib/mandates.ts";
import { friendlyError } from "../lib/rules.ts";
import type { Outreach as OutreachRow } from "../lib/types.ts";
import { OUTREACH_COLS } from "../components/TodayCrm.tsx";
import { DraftCard, ManualCard, OutreachLine } from "../components/OutreachCards.tsx";
import { Empty, ErrorBox, Loading, useTitle } from "../components/ui.tsx";
import { toast } from "../components/Toast.tsx";

const LIMIT = 200;

async function load(status: string) {
  const [counts, rows, parked] = await Promise.all([
    Promise.all(
      OUTREACH_STATUSES.map((s) =>
        supabase.from("outreach").select("id", { count: "exact", head: true }).eq("status", s).then((r) => mustCount(r).count),
      ),
    ),
    supabase.from("outreach").select(OUTREACH_COLS).eq("status", status).order("created_at", { ascending: false }).limit(LIMIT)
      .then((r) => must(r) as unknown as OutreachRow[]),
    supabase.from("outreach").select("id", { count: "exact", head: true }).eq("status", PARKED).then((r) => mustCount(r).count),
  ]);
  return { counts: new Map(OUTREACH_STATUSES.map((s, i) => [s as string, counts[i]])), rows, parked };
}

export default function Outreach() {
  useTitle("Outreach");
  const [sp] = useSearchParams();
  const raw = sp.get("status") ?? "draft";
  const status = (OUTREACH_STATUSES as readonly string[]).includes(raw) ? raw : "draft";
  const { data, error, loading, reload } = useLoad(() => load(status), `outreach-${status}`);

  return (
    <div className="stack-lg">
      <div className="section-head page-head-block">
        <span className="eyebrow">Pipeline</span>
        <h1>Outreach</h1>
        <p className="muted">Every email and LinkedIn message, by status. Nothing is sent without your approval.</p>
      </div>
      <nav className="tabs" aria-label="Status">
        {OUTREACH_STATUSES.map((s) => (
          <Link key={s} to={`/outreach?status=${s}`} className={s === status ? "active" : undefined}>
            {OUTREACH_STATUS_LABEL[s]} {data ? `(${fmtNumber(data.counts.get(s) ?? 0)})` : ""}
          </Link>
        ))}
      </nav>
      {error && !data ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data || data.rows.length === 0 ? (
        <Empty>Nothing here.</Empty>
      ) : (
        <section className="stack">
          {status === "draft"
            ? data.rows.map((o) => <DraftCard key={`${o.id}-${o.subject ?? ""}-${o.body ?? ""}`} o={o} onChanged={reload} />)
            : status === "manual"
              ? data.rows.map((o) => <ManualCard key={o.id} o={o} onChanged={reload} />)
              : <ul className="list">{data.rows.map((o) => <OutreachLine key={o.id} o={o} />)}</ul>}
          {(data.counts.get(status) ?? 0) > data.rows.length && <p className="muted small">Showing the newest {LIMIT}.</p>}
        </section>
      )}
      {data && data.parked > 0 && <Parked total={data.parked} onChanged={reload} />}
    </div>
  );
}

async function loadParked() {
  return must(
    await supabase.from("outreach").select(OUTREACH_COLS).eq("status", PARKED).order("created_at", { ascending: false }).limit(LIMIT),
  ) as unknown as OutreachRow[];
}

/** Old drafts kept for later: collapsed, read-only, each with "Bring back" (status back to draft). */
function Parked({ total, onChanged }: { total: number; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="parked" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <span>Parked ({fmtNumber(total)})</span>
        <span className="muted small">Old drafts kept for later. They stay out of Review and every count.</span>
      </summary>
      {open && <ParkedList total={total} onChanged={onChanged} />}
    </details>
  );
}

function ParkedList({ total, onChanged }: { total: number; onChanged: () => void }) {
  const { data, error, loading, reload } = useLoad(loadParked, "parked");
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const back = async (o: OutreachRow) => {
    setBusy(o.id);
    try {
      await outreachUnpark(o.id);
      setGone((s) => new Set(s).add(o.id));
      toast(`Brought back ${o.to_name ?? "the draft"}. It is in Review now.`);
      outreachChanged();
      onChanged();
    } catch (e) {
      toast(friendlyError(e), false);
    } finally {
      setBusy(null);
    }
  };
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Loading what="Getting parked drafts…" />;
  const rows = (data ?? []).filter((o) => !gone.has(o.id));
  return (
    <>
      <ul className="parked-list">
        {rows.map((o) => (
          <li key={o.id}>
            <div className="parked-main">
              <strong>{o.to_name || "Unnamed recipient"}</strong>
              {o.company && <span className="muted"> at {o.company}</span>}
              <p className="small muted">{o.subject || (o.channel === "linkedin" ? "LinkedIn message" : "No subject")}, drafted {fmtDateTime(o.created_at)}</p>
              {o.body && <p className="parked-body small">{truncate(o.body, 180)}</p>}
            </div>
            <button type="button" className="btn small" disabled={busy === o.id} onClick={() => back(o)}>
              {busy === o.id ? "Bringing back…" : "Bring back"}
            </button>
          </li>
        ))}
      </ul>
      {total > rows.length + gone.size && <p className="muted small parked-note">Showing the newest {LIMIT}.</p>}
    </>
  );
}
