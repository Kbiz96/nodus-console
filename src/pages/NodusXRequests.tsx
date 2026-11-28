import { useMemo, useState, type FormEvent } from "react";
import { supabase, must } from "../lib/supabase.ts";
import { useCached } from "../lib/cache.ts";
import { fmtDateTime } from "../lib/format.ts";
import { friendlyError } from "../lib/rules.ts";
import { toast } from "../components/Toast.tsx";
import { Empty, ErrorBox, Loading } from "../components/ui.tsx";
import { summarise, type NxListing } from "../lib/nodusx.ts";
import {
  CALL_LINK, CATEGORY_LABEL, REQUEST_SOURCE, REQ_STATUS, priority, rankRequests, composeLink, isOpen, isRequest, replyKind, replyText, reqState, reqStatus, requestedRef,
  type Level, type ReplyKind, type ReqCategory, type ReqStatus,
} from "../lib/nodusxRequests.ts";

const COLS = "id,created_at,side,kind,mw,gpus,gpu_model,market,timing,note,note_original,email,company,role,status,origin,source,deal,spec,ref,crm_contact_id,diligence,review_note,reject_reason,info_requested,reviewed_at,decision_emailed_at,decision_email,public_snapshot,published_at";

async function load(): Promise<NxListing[]> {
  return must(
    await supabase.from("board_listings").select(COLS).in("kind", ["gpu", "capacity"]).neq("origin", "public")
      .order("created_at", { ascending: false }).limit(800),
  ) as unknown as NxListing[];
}

async function saveReq(l: NxListing, patch: Record<string, unknown>) {
  const spec = { ...(l.spec ?? {}), req: { ...reqState(l), ...patch, updated: new Date().toISOString() } };
  must(await supabase.from("board_listings").update({ spec }).eq("id", l.id).select("id"));
}

/** NodusX requests: every request in one place, where it stands, and the reply that fits. */
export default function NodusXRequests() {
  const { data, error, loading, reload } = useCached(load, "nodusx:requests", 15_000);
  const [show, setShow] = useState<"open" | "all">("open");
  const [adding, setAdding] = useState(false);
  const all = useMemo(() => (data ?? []).filter(isRequest), [data]);
  const live = useMemo(() => (data ?? []).filter((l) => l.status === "approved" || l.status === "verified"), [data]);
  const rows = rankRequests(show === "open" ? all.filter(isOpen) : all);
  const owed = all.filter((l) => reqStatus(l) === "new").length;

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Loading what="Loading requests…" />;
  return (
    <div className="stack">
      <p className="small muted">
        The record of every NodusX request: website requests for a lot, emails to nodusx@ and RFQs that quote a lot.
        {" "}{owed} owed a reply. Each one gets the reply that fits: a named lot gets all the matching options, a thin
        request gets questions, a full one gets "we'll screen and come back". Every reply offers a call ({" "}
        <a href={CALL_LINK} target="_blank" rel="noreferrer">booking link</a>).
      </p>
      <div className="row gap">
        <button type="button" className={show === "open" ? "btn" : "btn ghost"} onClick={() => setShow("open")}>Open ({all.filter(isOpen).length})</button>
        <button type="button" className={show === "all" ? "btn" : "btn ghost"} onClick={() => setShow("all")}>All ({all.length})</button>
        <button type="button" className="btn ghost" onClick={() => setAdding((v) => !v)}>{adding ? "Cancel" : "Add a request from email"}</button>
      </div>
      {adding && <AddRequest onDone={() => { setAdding(false); reload(); }} />}
      {rows.length === 0 ? <Empty>No open requests.</Empty> : rows.map((l) => <RequestRow key={l.id} l={l} live={live} onDone={reload} />)}
    </div>
  );
}

function RequestRow({ l, live, onDone }: { l: NxListing; live: NxListing[]; onDone: () => void }) {
  const st = reqState(l);
  const ref = requestedRef(l);
  const [kind, setKind] = useState<ReplyKind>(() => replyKind(l));
  const [open, setOpen] = useState(false);
  const [gmail, setGmail] = useState(st.gmail ?? "");
  const [next, setNext] = useState(st.next ?? "");
  const [screen, setScreen] = useState(st.screen ?? "");
  const reply = replyText(l, kind, live);
  const [body, setBody] = useState(reply.body);
  const [busy, setBusy] = useState(false);

  async function update(patch: Record<string, unknown>, msg: string) {
    setBusy(true);
    try { await saveReq(l, patch); toast(msg); onDone(); } catch (e) { toast(friendlyError(e), false); } finally { setBusy(false); }
  }

  return (
    <div className="card stack-sm">
      <div className="row between gap wrap">
        <div>
          <strong>{l.company || l.email}</strong>{ref && <span className="badge">{ref}</span>}
          <div className="small muted">{fmtDateTime(l.created_at)} · {l.email} · {l.source === REQUEST_SOURCE ? "Email" : "Website"}</div>
        </div>
        <select value={reqStatus(l)} disabled={busy} onChange={(e) => update({ status: e.target.value as ReqStatus }, "Status saved")}>
          {REQ_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
      <div className="row gap wrap small">
        <select value={st.category ?? "unscreened"} disabled={busy} onChange={(e) => update({ category: e.target.value as ReqCategory }, "Saved")}>
          {(Object.keys(CATEGORY_LABEL) as ReqCategory[]).map((k) => <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>)}
        </select>
        <label>Legitimacy <select value={st.legit ?? ""} disabled={busy} onChange={(e) => update({ legit: Number(e.target.value) as Level }, "Saved")}>
          <option value="">–</option><option value="1">Low</option><option value="2">Medium</option><option value="3">High</option></select></label>
        <label>Urgency <select value={st.urgency ?? ""} disabled={busy} onChange={(e) => update({ urgency: Number(e.target.value) as Level }, "Saved")}>
          <option value="">–</option><option value="1">Low</option><option value="2">Medium</option><option value="3">High</option></select></label>
        <span className="muted">Priority {priority(l) || "–"}</span>
      </div>
      {st.screen && <p className="small">Screening: {st.screen}</p>}
      <div>{summarise(l)}</div>
      {(l.note_original || l.note) && <p className="small muted">{l.note_original ?? l.note}</p>}
      <div className="row gap wrap small">
        {st.gmail ? <a href={st.gmail} target="_blank" rel="noreferrer">Open thread in Gmail</a> : <span className="muted">No thread linked</span>}
        {st.next && <span>Next: {st.next}</span>}
        <button type="button" className="link-btn" onClick={() => setOpen((v) => !v)}>{open ? "Hide reply" : "Reply"}</button>
      </div>
      {open && (
        <div className="stack-sm">
          <div className="row gap wrap small">
            {(["lot", "info", "screen"] as ReplyKind[]).map((k) => (
              <label key={k}><input type="radio" checked={kind === k} onChange={() => { setKind(k); setBody(replyText(l, k, live).body); }} />{" "}
                {k === "lot" ? "Options for the lot" : k === "info" ? "Ask for details" : "We'll screen"}</label>
            ))}
          </div>
          <textarea rows={14} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="row gap wrap">
            <button type="button" className="btn" onClick={async () => { await navigator.clipboard.writeText(body); toast("Copied"); }}>Copy</button>
            <a className="btn ghost" href={composeLink(l.email, reply.subject, body)} target="_blank" rel="noreferrer">Open in Gmail</a>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => update({ status: "replied" }, "Marked replied")}>Mark replied</button>
          </div>
          <div className="row gap wrap">
            <input placeholder="Gmail thread link" value={gmail} onChange={(e) => setGmail(e.target.value)} />
            <input placeholder="Next step" value={next} onChange={(e) => setNext(e.target.value)} />
            <input placeholder="Screening note" value={screen} onChange={(e) => setScreen(e.target.value)} />
            <button type="button" className="btn ghost" disabled={busy} onClick={() => update({ gmail: gmail.trim() || undefined, next: next.trim() || undefined, screen: screen.trim() || undefined }, "Saved")}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddRequest({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ email: "", company: "", request_of: "", side: "need", kind: "gpu", gpus: "", gpu_model: "B300", mw: "", market: "", timing: "", note: "", gmail: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.email.includes("@")) { toast("Add their email", false); return; }
    setBusy(true);
    try {
      must(await supabase.from("board_listings").insert({
        side: f.side, kind: f.kind, gpus: f.gpus ? Number(f.gpus) : null, gpu_model: f.kind === "gpu" ? f.gpu_model || null : null,
        mw: f.mw ? Number(f.mw) : null, market: f.market.trim() || "Unspecified", timing: f.timing.trim() || null,
        note: f.note.trim() || null, note_original: f.note.trim() || null, email: f.email.trim(), company: f.company.trim() || null,
        status: "private", origin: "email", source: REQUEST_SOURCE,
        spec: { request_of: f.request_of.trim().toUpperCase() || undefined, req: { status: "new", gmail: f.gmail.trim() || undefined, updated: new Date().toISOString() } },
      }).select("id"));
      toast("Request added");
      onDone();
    } catch (err) { toast(friendlyError(err), false); } finally { setBusy(false); }
  }

  return (
    <form className="card stack-sm" onSubmit={submit}>
      <div className="row gap wrap">
        <input placeholder="Their email" value={f.email} onChange={set("email")} required />
        <input placeholder="Company" value={f.company} onChange={set("company")} />
        <input placeholder="Lot asked about (NX-22)" value={f.request_of} onChange={set("request_of")} />
        <input placeholder="Gmail thread link" value={f.gmail} onChange={set("gmail")} />
      </div>
      <div className="row gap wrap">
        <select value={f.side} onChange={set("side")}><option value="need">They need capacity</option><option value="have">They offer capacity</option></select>
        <select value={f.kind} onChange={set("kind")}><option value="gpu">GPUs</option><option value="capacity">Data-centre space</option></select>
        {f.kind === "gpu" ? <><input placeholder="GPUs" value={f.gpus} onChange={set("gpus")} inputMode="numeric" /><input placeholder="Model" value={f.gpu_model} onChange={set("gpu_model")} /></>
          : <input placeholder="MW" value={f.mw} onChange={set("mw")} inputMode="decimal" />}
        <input placeholder="Location" value={f.market} onChange={set("market")} />
        <input placeholder="Timing" value={f.timing} onChange={set("timing")} />
      </div>
      <textarea rows={3} placeholder="What they asked for" value={f.note} onChange={set("note")} />
      <div><button className="btn" disabled={busy}>Add request</button></div>
    </form>
  );
}
