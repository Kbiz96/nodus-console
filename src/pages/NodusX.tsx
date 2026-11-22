import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { useCached } from "../lib/cache.ts";
import { fmtDateTime } from "../lib/format.ts";
import { friendlyError } from "../lib/rules.ts";
import { toast } from "../components/Toast.tsx";
import NodusXIntros from "./NodusXIntros.tsx";
import { Empty, ErrorBox, Loading, useTitle } from "../components/ui.tsx";
import {
  DILIGENCE, QUEUES, STATUS_LABEL, ageDays, decisionEmail, forbiddenWords, publicNoteWarnings, summarise,
  type Draft, type NxDecision, type NxListing, unpublishedChanges,
} from "../lib/nodusx.ts";

const FN = "nodusx-review";
const COLS = "id,created_at,side,kind,mw,gpus,gpu_model,market,timing,note,note_original,email,company,role,status,origin,source,deal,spec,ref,crm_contact_id,diligence,review_note,reject_reason,info_requested,reviewed_at,decision_emailed_at,decision_email,public_snapshot,published_at,agreement:nodusx_agreements(id,created_at,role,terms_version,full_name,job_title,company,email,ip,signature_image)";

/** NodusX submissions and Nodus's own lots; public scrapes from the old Watt Street board are left out. */
async function load(): Promise<NxListing[]> {
  return must(
    await supabase.from("board_listings").select(COLS).in("kind", ["gpu", "capacity"]).neq("origin", "public")
      .order("created_at", { ascending: false }).limit(500),
  ) as unknown as NxListing[];
}

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(FN, { body });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.message ?? data?.reason ?? "The decision did not save.");
  return data as { ok: true; row?: NxListing; emailed?: boolean; message?: string };
}

export default function NodusX() {
  useTitle("NodusX");
  const [sp, setSp] = useSearchParams();
  const isMap = !sp.get("q") || sp.get("q") === "map";
  const isIntros = sp.get("q") === "intros";
  const queue = QUEUES.find((q) => q.key === sp.get("q")) ?? QUEUES[0];
  const { data, error, loading, reload } = useCached(load, "nodusx:listings", 15_000);
  const counts = useMemo(() => Object.fromEntries(QUEUES.map((q) => [q.key, (data ?? []).filter((l) => q.statuses.includes(l.status)).length])), [data]);
  const shown = (data ?? []).filter((l) => queue.statuses.includes(l.status));
  const unpublished = (data ?? []).filter((l) => unpublishedChanges(l).length > 0).length;
  const live = (data ?? []).filter((l) => l.status === "approved" || l.status === "verified");

  return (
    <div className="stack-lg">
      <div className="section-head page-head-block">
        <span className="eyebrow">Marketplace</span>
        <h1>NodusX</h1>
        <p className="muted">
          Every listing submitted on NodusX lands here. Nothing is public until you approve it. Check the party, tick the
          diligence, set the public wording, then approve, ask for more, or decline. The submitter is emailed from
          nodusx@nodus.partners when you decide (replies land under the NodusX label).
        </p>
        <p className="small muted">
          Live now: {live.filter((l) => l.side === "have").length} supply, {live.filter((l) => l.side === "need").length} requirements.{" "}
          <a href="https://nodus-partners-webs-git-6a058a-kuransailopal-gmailcoms-projects.vercel.app/nodusx" target="_blank" rel="noreferrer">Open the board</a>{" · "}
          <a href="./nodusx-map/" target="_blank" rel="noreferrer">Match map (internal)</a>
        </p>
      </div>

      <nav className="tabs" aria-label="Queue">
        <Link to="/nodusx?q=map" className={isMap ? "active" : undefined}>Match map</Link>
        <Link to="/nodusx?q=intros" className={isIntros ? "active" : undefined}>Introductions</Link>
        {QUEUES.map((q) => (
          <Link key={q.key} to={`/nodusx?q=${q.key}`} className={!isMap && !isIntros && q.key === queue.key ? "active" : undefined}>
            {q.label} ({counts[q.key] ?? 0}){q.key === "live" && unpublished ? ` · ${unpublished} unpublished` : ""}
          </Link>
        ))}
        <button type="button" className="link-btn" onClick={reload}>Refresh</button>
      </nav>

      {isMap ? (
        <div className="nx-map-frame">
          <p className="small muted">
            Every line on NodusX, including ones still in review, with who is behind it and what it matches. Updates itself every 30 seconds.
            The public board only changes when you approve a line or publish its changes.
          </p>
          <iframe title="NodusX match map" src="./nodusx-map/?embed=1" style={{ width: "100%", height: "calc(100vh - 230px)", minHeight: 620, border: "1px solid var(--rule, #ddd)", borderRadius: 8, background: "#EDF1F3" }} />
        </div>
      ) : isIntros ? <NodusXIntros />
      : error && !data ? <ErrorBox error={error} onRetry={reload} />
        : loading && !data ? <Loading what="Loading submissions…" />
        : shown.length === 0 ? <Empty>{queue.key === "review" ? "Nothing waiting. New submissions appear here the moment they are sent." : "None."}</Empty>
        : (
          <div className="stack">
            {shown.map((l) => <ListingCard key={l.id} l={l} onDone={() => { reload(); if (sp.get("id")) setSp({ q: queue.key }); }} />)}
          </div>
        )}
    </div>
  );
}

function ListingCard({ l, onDone }: { l: NxListing; onDone: () => void }) {
  const [open, setOpen] = useState(l.status === "pending" || l.status === "info_requested");
  const [checks, setChecks] = useState<Record<string, boolean>>(() => Object.fromEntries(DILIGENCE.map((d) => [d.key, Boolean(l.diligence?.[d.key])])));
  const [notes, setNotes] = useState(l.review_note ?? "");
  const [pub, setPub] = useState(l.note ?? "");
  const [showPrice, setShowPrice] = useState(Boolean(l.spec?.price));
  const [compose, setCompose] = useState<{ decision: NxDecision; draft: Draft | null; reason: string; info: string; send: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const done = DILIGENCE.filter((d) => checks[d.key]).length;
  const warnings = publicNoteWarnings(pub, l);
  const isBrief = l.source === "nodusx-brief" || l.status === "private";
  const spec = Object.entries(l.spec ?? {}).filter(([, v]) => v);
  // Nodus's own lots carry a placeholder address (seed@nodus.partners): there is no submitter to email.
  const internal = l.origin === "nodus" || /^seed@/i.test(l.email);

  const start = (decision: NxDecision) => {
    const draft = internal ? null : decisionEmail(l, decision, { ref: decision === "approve" || decision === "verify" ? l.ref ?? "NX-…" : l.ref });
    setCompose({ decision, draft, reason: "", info: "", send: Boolean(draft) });
  };
  const refresh = (c: NonNullable<typeof compose>, patch: Partial<NonNullable<typeof compose>>) => {
    const n = { ...c, ...patch };
    if ("reason" in patch || "info" in patch) {
      const d = decisionEmail(l, n.decision, { ref: l.ref ?? "NX-…", reason: n.reason, info: n.info });
      if (d && c.draft) n.draft = { ...c.draft, body: d.body };
    }
    setCompose(n);
  };

  const publish = async () => {
    if (warnings.length) { toast(`Fix the public wording first: ${warnings[0]}`, false); return; }
    setBusy(true);
    try {
      must(await supabase.rpc("nodusx_decide", { p_id: l.id, p_decision: "publish", p_public_note: pub.trim() || null, p_review_note: notes, p_diligence: checks }));
      toast("Published. The public board now shows this version.", true);
      onDone();
    } catch (e) {
      toast(friendlyError(e), false);
    } finally {
      setBusy(false);
    }
  };

  const run = async (decision: NxDecision, extra: { reason?: string; info?: string; draft?: Draft | null } = {}) => {
    const draft = extra.draft ?? null;
    if (draft) {
      const bad = forbiddenWords(`${draft.subject}\n${draft.body}`);
      if (bad.length) { toast(`Take out ${bad.join(", ")} first: no fees or prices in these emails.`, false); return; }
      if (/NX-…/.test(draft.subject + draft.body) && l.ref) draft.body = draft.body.replaceAll("NX-…", l.ref);
    }
    if ((decision === "approve" || decision === "verify") && warnings.length) { toast(`Fix the public wording first: ${warnings[0]}`, false); return; }
    setBusy(true);
    try {
      // Price shows on the board only when ticked.
      if ((decision === "approve" || decision === "verify") && l.spec?.price && !showPrice) {
        const rest = Object.fromEntries(Object.entries(l.spec).filter(([k]) => k !== "price" && k !== "price_unit"));
        must(await supabase.from("board_listings").update({ spec: rest }).eq("id", l.id).select("id"));
      }
      // The ref is assigned at approval, so a "NX-…" placeholder is sent as the real ref: decide first, then email.
      const needsRef = Boolean(draft && /NX-…/.test(draft.subject + draft.body));
      const first = await call({
        action: "decide", id: l.id, decision, public_note: pub.trim() || null, reason: extra.reason, info: extra.info,
        review_note: notes, diligence: checks, email: needsRef ? undefined : draft ?? undefined,
      });
      let emailed = first.emailed;
      if (needsRef && draft) {
        const ref = first.row?.ref ?? "";
        const fix = (s: string) => (ref ? s.replaceAll("NX-…", ref) : s.replace(/[: ]*(as )?NX-…/g, ""));
        await call({ action: "email", id: l.id, email: { to: draft.to, subject: fix(draft.subject), body: fix(draft.body) } });
        emailed = true;
      }
      toast(first.message ?? `${decision === "save" ? "Saved" : "Done"}${emailed ? ", and emailed" : ""}.`, !first.message);
      setCompose(null);
      onDone();
    } catch (e) {
      toast(friendlyError(e), false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="card stack-sm" id={l.id}>
      <div className="row-between">
        <div className="stack-xs">
          <span className="eyebrow">
            {l.ref ? `${l.ref} · ` : ""}{STATUS_LABEL[l.status]} · {l.side === "have" ? "Supply" : "Requirement"} · submitted {fmtDateTime(l.created_at)}
            {l.status === "pending" && ageDays(l.created_at) >= 1 ? ` · waiting ${ageDays(l.created_at)}d` : ""}
          </span>
          <strong>{summarise(l)}</strong>
          {unpublishedChanges(l).length > 0 && (
            <span className="small" style={{ color: "#B5541B" }}>
              Unpublished changes: {unpublishedChanges(l).join(", ")}. The public board still shows the last published version.
            </span>
          )}
          <span className="small muted">
            {internal ? "Nodus lot, internal (no submitter to email)" : <>{l.company ?? "No company given"}{l.role ? ` · ${l.role}` : ""} · <a href={`mailto:${l.email}`}>{l.email}</a></>}
            {l.crm_contact_id && <> · <Link to={`/contacts?id=${l.crm_contact_id}`}>CRM</Link></>}
          </span>
        </div>
        <button type="button" className="btn ghost" onClick={() => setOpen(!open)}>{open ? "Close" : "Open"}</button>
      </div>

      {open && (
        <div className="stack">
          {isBrief && <p className="warn small">Private brief: never published. Work it directly and reply from Gmail.</p>}
          <div className="grid-2">
            <section className="stack-xs">
              <h3 className="sec-title">What they submitted</h3>
              <dl className="facts">
                <dt>Deal</dt><dd>{l.deal ?? "—"}</dd>
                <dt>GPU</dt><dd>{l.gpu_model ?? "—"}</dd>
                <dt>Size</dt><dd>{l.gpus ? `${l.gpus.toLocaleString("en-GB")} GPUs` : l.mw ? `${Math.round(l.mw * 1000).toLocaleString("en-GB")} kW` : "—"}</dd>
                <dt>Location</dt><dd>{l.market}</dd>
                <dt>Timing</dt><dd>{l.timing ?? "—"}</dd>
                {spec.map(([k, v]) => <FactRow key={k} k={k} v={v} />)}
                <dt>Their note</dt><dd>{l.note_original ?? "—"}</dd>
              </dl>
            </section>
            <section className="stack-xs">
              <h3 className="sec-title">Signed terms</h3>
              {l.agreement ? (
                <dl className="facts">
                  <dt>Signed by</dt><dd>{l.agreement.full_name}, {l.agreement.job_title}</dd>
                  <dt>For</dt><dd>{l.agreement.company}</dd>
                  <dt>Terms</dt><dd>{l.agreement.role} v{l.agreement.terms_version}</dd>
                  <dt>When</dt><dd>{fmtDateTime(l.agreement.created_at)}</dd>
                  <dt>IP</dt><dd className="mono">{l.agreement.ip ?? "—"}</dd>
                  {l.agreement.signature_image && <><dt>Signature</dt><dd><img src={l.agreement.signature_image} alt="Drawn signature" style={{ maxWidth: 220, background: "#fff", borderRadius: 4 }} /></dd></>}
                </dl>
              ) : <p className="small muted">{l.origin === "nodus" ? "Nodus lot: no terms signed through the site." : "No signed terms linked. Ask them to sign before listing."}</p>}
              <p className="small">
                Check: <a href={`https://www.google.com/search?q=${encodeURIComponent(`${l.company ?? l.email.split("@")[1]} data centre GPU`)}`} target="_blank" rel="noreferrer">Google</a>{" · "}
                <a href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${l.agreement?.full_name ?? ""} ${l.company ?? ""}`)}`} target="_blank" rel="noreferrer">LinkedIn</a>{" · "}
                <a href={`https://find-and-update.company-information.service.gov.uk/search?q=${encodeURIComponent(l.company ?? "")}`} target="_blank" rel="noreferrer">Companies House</a>{" · "}
                <a href={`https://${l.email.split("@")[1]}`} target="_blank" rel="noreferrer">{l.email.split("@")[1]}</a>
              </p>
            </section>
          </div>

          <section className="stack-xs">
            <h3 className="sec-title">Diligence ({done}/{DILIGENCE.length})</h3>
            {DILIGENCE.map((d) => (
              <label key={d.key} className="check">
                <input type="checkbox" checked={checks[d.key]} onChange={(e) => setChecks({ ...checks, [d.key]: e.target.checked })} />{" "}
                <span>{d.label}</span> <span className="small muted">{d.hint}</span>
              </label>
            ))}
            <label className="field">
              <span>Notes (internal)</span>
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Who you spoke to, what you saw, anything odd." />
            </label>
          </section>

          {!isBrief && (
            <section className="stack-xs">
              <h3 className="sec-title">Public wording</h3>
              <label className="field">
                <span>Shown on the board ({pub.length}/160). No names, addresses or contact details.</span>
                <textarea rows={2} value={pub} maxLength={200} onChange={(e) => setPub(e.target.value)} />
              </label>
              {warnings.map((w) => <p key={w} className="error small">{w}</p>)}
              {l.spec?.price && (
                <label className="check small">
                  <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} /> Show their indicative price on the board ({l.spec.price} {l.spec.price_unit ?? ""})
                </label>
              )}
            </section>
          )}

          {l.decision_email?.at && <p className="small muted">Last emailed {fmtDateTime(l.decision_email.at)}: “{l.decision_email.subject}”.</p>}
          {l.info_requested && l.status === "info_requested" && <p className="small muted">Asked for: {l.info_requested}</p>}
          {l.reject_reason && l.status === "rejected" && <p className="small muted">Declined: {l.reject_reason}</p>}

          {compose ? (
            <Composer
              c={compose} busy={busy}
              onChange={(p) => refresh(compose, p)}
              onCancel={() => setCompose(null)}
              onGo={() => run(compose.decision, { reason: compose.reason, info: compose.info, draft: compose.send ? compose.draft : null })}
            />
          ) : (
            <div className="action-row">
              {(l.status === "pending" || l.status === "info_requested") && !isBrief && (
                <>
                  <button type="button" className="btn primary" disabled={busy || done < 4} title={done < 4 ? "Tick at least four diligence checks first" : undefined} onClick={() => start("approve")}>Approve and publish</button>
                  <button type="button" className="btn" disabled={busy} onClick={() => start("info")}>Ask for more</button>
                  <button type="button" className="btn" disabled={busy} onClick={() => start("reject")}>Decline</button>
                </>
              )}
              {l.status === "approved" && <button type="button" className="btn" disabled={busy || done < DILIGENCE.length} title={done < DILIGENCE.length ? "All checks first" : undefined} onClick={() => run("verify")}>Mark verified</button>}
              {(l.status === "approved" || l.status === "verified") && <button type="button" className="btn" disabled={busy} onClick={() => start("withdraw")}>Take down</button>}
              {(l.status === "rejected" || l.status === "withdrawn") && <button type="button" className="btn" disabled={busy} onClick={() => run("reopen")}>Reopen</button>}
              {unpublishedChanges(l).length > 0 && (
                <button type="button" className="btn primary" disabled={busy} onClick={() => publish()}>Publish changes</button>
              )}
              <button type="button" className="btn ghost" disabled={busy} onClick={() => run("save")}>Save notes</button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

const SPEC_LABEL: Record<string, string> = {
  type: "Type", party: "Party", form_factor: "Configuration", nodes: "Nodes", gpus_per_node: "GPUs per node", unit: "Unit", cpu: "CPU", memory: "Memory",
  local_storage: "Local storage", shared_storage: "Shared storage", storage: "Storage", fabric: "Fabric", frontend: "Front-end network", cooling: "Cooling",
  tier: "Tier", power: "Power", delivery: "Delivery", available_from: "Available from", min_term: "Minimum term", term: "Term", price: "Indicative price",
  price_unit: "Price unit", power_kwh: "Power (per kWh)", prepay: "Prepayment", party_note: "Party note", price_net: "Net price",
};
function FactRow({ k, v }: { k: string; v: string }) {
  return <><dt>{SPEC_LABEL[k] ?? k}</dt><dd>{v}</dd></>;
}

function Composer({ c, busy, onChange, onCancel, onGo }: {
  c: { decision: NxDecision; draft: Draft | null; reason: string; info: string; send: boolean };
  busy: boolean;
  onChange: (p: Partial<typeof c>) => void;
  onCancel: () => void;
  onGo: () => void;
}) {
  const label = { approve: "Approve and publish", verify: "Mark verified", info: "Ask for more", reject: "Decline", withdraw: "Take down", reopen: "Reopen", save: "Save" }[c.decision];
  const bad = c.draft ? forbiddenWords(`${c.draft.subject}\n${c.draft.body}`) : [];
  return (
    <section className="card stack-sm">
      <h3 className="sec-title">{label}</h3>
      {c.decision === "info" && (
        <label className="field"><span>What do you need from them? (one per line)</span>
          <textarea rows={3} value={c.info} onChange={(e) => onChange({ info: e.target.value })} placeholder={"- Confirmed ready-for-service date\n- Site location (city)\n- Who owns the hardware"} />
        </label>
      )}
      {c.decision === "reject" && (
        <label className="field"><span>Reason (goes in the email; keep it short and polite)</span>
          <input value={c.reason} onChange={(e) => onChange({ reason: e.target.value })} placeholder="we only list capacity with a confirmed ready-for-service date" />
        </label>
      )}
      {c.draft && (
        <>
          <label className="check"><input type="checkbox" checked={c.send} onChange={(e) => onChange({ send: e.target.checked })} /> Email them from nodusx@nodus.partners</label>
          {c.send && (
            <div className="stack-xs">
              <label className="field"><span>To</span><input value={c.draft.to} onChange={(e) => onChange({ draft: { ...c.draft!, to: e.target.value } })} /></label>
              <label className="field"><span>Subject</span><input value={c.draft.subject} onChange={(e) => onChange({ draft: { ...c.draft!, subject: e.target.value } })} /></label>
              <label className="field"><span>Email</span><textarea rows={12} value={c.draft.body} onChange={(e) => onChange({ draft: { ...c.draft!, body: e.target.value } })} /></label>
              {c.decision === "approve" && <p className="small muted">NX-… becomes the listing's reference when you approve.</p>}
              {bad.length > 0 && <p className="error small">Remove before sending: {bad.join(", ")}. No fees or prices in these emails.</p>}
            </div>
          )}
        </>
      )}
      <div className="action-row">
        <button type="button" className="btn primary" disabled={busy || bad.length > 0 || (c.decision === "info" && !c.info.trim())} onClick={onGo}>
          {busy ? "Working…" : c.send && c.draft ? `${label} and email` : label}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}
