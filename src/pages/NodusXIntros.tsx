import { useState } from "react";
import { supabase, must } from "../lib/supabase.ts";
import { useCached } from "../lib/cache.ts";
import { fmtDateTime } from "../lib/format.ts";
import { friendlyError } from "../lib/rules.ts";
import { toast } from "../components/Toast.tsx";
import { Empty, ErrorBox, Loading } from "../components/ui.tsx";

/** NodusX introductions: operator accepts in one click (fee agreed), then tracked to contract, invoice, payment and our fee. */
const BOARD = "https://nodus.partners";

type Intro = {
  id: string; ref: string; token: string; status: string; fee_pct: number;
  operator_company: string | null; operator_email: string | null; buyer_company: string | null; buyer_email: string | null;
  opportunity: Record<string, string>; supply_listing_id: string | null; need_listing_id: string | null;
  sent_at: string | null; accepted_at: string | null; accepted_name: string | null; accepted_title: string | null; claim_deadline: string | null;
  declined_at: string | null; decline_reason: string | null; introduced_at: string | null; operator_ready_at: string | null; buyer_ready_at: string | null;
  contracted_at: string | null; contract_value: number | null; currency: string | null; invoice_ref: string | null; invoiced_at: string | null;
  buyer_paid_at: string | null; amount_received: number | null; money_received_at: string | null; fee_amount: number | null;
  fee_invoice_ref: string | null; fee_due: string | null; fee_paid_at: string | null; notes: string | null; created_at: string;
};
type Lite = { id: string; ref: string | null; side: string; kind: string; gpus: number | null; mw: number | null; gpu_model: string | null; market: string | null; timing: string | null; company: string | null; email: string | null; deal: string | null; note: string | null };

const STAGES: { key: string; label: string; done: (i: Intro) => boolean }[] = [
  { key: "sent", label: "Sent to operator", done: (i) => !!i.sent_at },
  { key: "accepted", label: "Accepted (fee agreed)", done: (i) => !!i.accepted_at },
  { key: "introduced", label: "Introduced", done: (i) => !!i.introduced_at },
  { key: "ready", label: "Both ready", done: (i) => !!(i.operator_ready_at && i.buyer_ready_at) },
  { key: "contracted", label: "Contracted", done: (i) => !!i.contracted_at },
  { key: "invoiced", label: "Invoiced", done: (i) => !!i.invoiced_at },
  { key: "paid", label: "Money received", done: (i) => !!i.money_received_at },
  { key: "fee_invoiced", label: "Fee invoiced", done: (i) => !!i.fee_invoice_ref },
  { key: "fee_paid", label: "Fee paid", done: (i) => !!i.fee_paid_at },
];

function addBusinessDays(d: Date, n: number) { const x = new Date(d); while (n > 0) { x.setDate(x.getDate() + 1); if (x.getDay() !== 0 && x.getDay() !== 6) n--; } return x; }
const iso = (d: Date) => d.toISOString().slice(0, 10);
const money = (n: number | null, c = "USD") => (n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: c || "USD", maximumFractionDigits: 0 }).format(n));
const lineLabel = (l: Lite) => `${l.ref ?? "—"} · ${l.mw && !l.gpus ? `${l.mw} MW` : `${l.gpus ?? "?"} ${l.gpu_model ?? "GPUs"}`} · ${l.market ?? ""}${l.company ? ` · ${l.company}` : ""}`;

async function loadAll() {
  const [intros, lines] = await Promise.all([
    supabase.from("nodusx_introductions").select("*").order("created_at", { ascending: false }).limit(200),
    supabase.from("board_listings").select("id,ref,side,kind,gpus,mw,gpu_model,market,timing,company,email,deal,note").in("kind", ["gpu", "capacity"]).neq("origin", "public").in("status", ["approved", "verified", "private", "pending"]).order("ref"),
  ]);
  return { intros: must(intros) as unknown as Intro[], lines: must(lines) as unknown as Lite[] };
}

async function patch(id: string, v: Partial<Intro>) { must(await supabase.from("nodusx_introductions").update(v).eq("id", id).select("id")); }

export default function NodusXIntros() {
  const { data, error, loading, reload } = useCached(loadAll, "nodusx-intros", 15_000);
  const [creating, setCreating] = useState(false);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Loading what="Loading introductions…" />;
  const intros = data?.intros ?? [], lines = data?.lines ?? [];
  const open = intros.filter((i) => !["fee_paid", "lost", "withdrawn", "declined", "expired"].includes(i.status));
  const feeDue = intros.filter((i) => i.fee_invoice_ref && !i.fee_paid_at).reduce((a, i) => a + (i.fee_amount ?? 0), 0);
  return (
    <div className="nx-intros">
      <p className="small muted">
        Each introduction has a secret link. The operator sees the requirement without the buyer's name and accepts in one click, which agrees the {intros[0]?.fee_pct ?? 2}% fee under Operator Terms v1.3. You send the link yourself.
        {" "}<b>{open.length}</b> open · fees invoiced and unpaid <b>{money(feeDue)}</b>.
      </p>
      <p><button type="button" className="btn" onClick={() => setCreating((v) => !v)}>{creating ? "Close" : "New introduction"}</button></p>
      {creating && <Create lines={lines} onDone={() => { setCreating(false); reload(); }} />}
      {intros.length === 0 ? <Empty>No introductions yet. Start one from a supply line and a requirement.</Empty> : intros.map((i) => <Card key={i.id} i={i} onDone={reload} />)}
    </div>
  );
}

function Create({ lines, onDone }: { lines: Lite[]; onDone: () => void }) {
  const have = lines.filter((l) => l.side === "have"), need = lines.filter((l) => l.side === "need");
  const [s, setS] = useState(""), [n, setN] = useState("");
  const [f, setF] = useState({ operator_company: "", operator_email: "", buyer_company: "", buyer_email: "", headline: "", gpu: "", quantity: "", region: "", start: "", term: "", budget: "", notes: "" });
  const pick = (sid: string, nid: string) => {
    const sl = have.find((l) => l.id === sid), nl = need.find((l) => l.id === nid);
    setF((p) => ({ ...p,
      operator_company: sl?.company?.replace(/\s*\(internal\)/i, "") ?? p.operator_company, operator_email: sl?.email && !/seed@/.test(sl.email) ? sl.email : p.operator_email,
      buyer_company: nl?.company?.replace(/\s*\(internal\)/i, "") ?? p.buyer_company, buyer_email: nl?.email && !/seed@/.test(nl.email) ? nl.email : p.buyer_email,
      headline: nl ? `${nl.gpus ? nl.gpus.toLocaleString("en-GB") + " " : ""}${nl.gpu_model ?? (nl.mw ? nl.mw + " MW" : "capacity")} wanted${nl.timing ? ", " + nl.timing : ""}` : p.headline,
      gpu: nl?.gpu_model ?? p.gpu, quantity: nl?.gpus ? `${nl.gpus} GPUs` : nl?.mw ? `${nl.mw} MW` : p.quantity, region: nl?.market ?? p.region, start: nl?.timing ?? p.start, term: nl?.deal ?? p.term, notes: nl?.note ?? p.notes }));
  };
  const save = async () => {
    if (!f.operator_company || !f.buyer_company) { toast("Add the operator and the buyer.", false); return; }
    const opportunity = Object.fromEntries(Object.entries({ headline: f.headline, gpu: f.gpu, quantity: f.quantity, region: f.region, start: f.start, term: f.term, budget: f.budget, notes: f.notes }).filter(([, v]) => v));
    try {
      must(await supabase.from("nodusx_introductions").insert({ supply_listing_id: s || null, need_listing_id: n || null, operator_company: f.operator_company, operator_email: f.operator_email || null, buyer_company: f.buyer_company, buyer_email: f.buyer_email || null, opportunity }).select("id"));
      toast("Introduction drafted. Check the wording, then copy the link and mark it sent.", true); onDone();
    } catch (e) { toast(friendlyError(e), false); }
  };
  const inp = (k: keyof typeof f, label: string, wide = false) => (
    <label style={wide ? { gridColumn: "1/-1" } : undefined}>{label}<input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );
  return (
    <div className="card" style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", marginBottom: 18 }}>
      <label>Supply line<select value={s} onChange={(e) => { setS(e.target.value); pick(e.target.value, n); }}><option value="">None (off-board)</option>{have.map((l) => <option key={l.id} value={l.id}>{lineLabel(l)}</option>)}</select></label>
      <label>Requirement<select value={n} onChange={(e) => { setN(e.target.value); pick(s, e.target.value); }}><option value="">None (off-board)</option>{need.map((l) => <option key={l.id} value={l.id}>{lineLabel(l)}</option>)}</select></label>
      {inp("operator_company", "Operator company")}{inp("operator_email", "Operator email")}
      {inp("buyer_company", "Buyer company (revealed on accept)")}{inp("buyer_email", "Buyer email")}
      <p className="small muted" style={{ gridColumn: "1/-1", margin: 0 }}>What the operator sees before accepting. No buyer name.</p>
      {inp("headline", "Headline", true)}{inp("gpu", "GPU")}{inp("quantity", "Quantity")}{inp("region", "Region")}{inp("start", "Start")}{inp("term", "Term")}{inp("budget", "Budget")}{inp("notes", "Notes", true)}
      <div style={{ gridColumn: "1/-1" }}><button type="button" className="btn" onClick={save}>Save draft</button></div>
    </div>
  );
}

function Card({ i, onDone }: { i: Intro; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const link = `${BOARD}/nodusx/accept/?t=${i.token}`;
  const act = async (v: Partial<Intro>, msg: string) => { setBusy(true); try { await patch(i.id, v); toast(msg, true); onDone(); } catch (e) { toast(friendlyError(e), false); } finally { setBusy(false); } };
  const now = new Date().toISOString();
  const next = (() => {
    if (i.status === "draft") return <><button className="btn" disabled={busy} onClick={() => { navigator.clipboard?.writeText(link); toast("Link copied. Paste it into your email to the operator.", true); }}>Copy accept link</button>
      <button className="btn ghost" disabled={busy} onClick={() => act({ status: "sent", sent_at: now }, "Marked as sent. The link is now live.")}>Mark as sent</button></>;
    if (i.status === "sent") return <><span className="small muted">Waiting for the operator to accept.</span><button className="link-btn" onClick={() => { navigator.clipboard?.writeText(link); toast("Link copied.", true); }}>Copy link</button></>;
    if (i.status === "accepted") return <button className="btn" disabled={busy} onClick={() => act({ status: "introduced", introduced_at: now }, "Recorded: introduction email sent.")}>Introduction email sent</button>;
    if (i.status === "introduced" || i.status === "ready") return <>
      {!i.operator_ready_at && <button className="btn ghost" disabled={busy} onClick={() => act({ operator_ready_at: now, ...(i.buyer_ready_at ? { status: "ready" } : {}) }, "Operator ready.")}>Operator ready</button>}
      {!i.buyer_ready_at && <button className="btn ghost" disabled={busy} onClick={() => act({ buyer_ready_at: now, ...(i.operator_ready_at ? { status: "ready" } : {}) }, "Buyer ready.")}>Buyer ready</button>}
      <button className="btn" disabled={busy} onClick={() => { const v = prompt("Contract value (number, in the contract currency)?"); if (v === null) return; const c = prompt("Currency (USD, GBP, EUR)?", "USD") || "USD"; act({ status: "contracted", contracted_at: now, contract_value: Number(v) || null, currency: c.toUpperCase() }, "Contract recorded."); }}>Contract signed</button></>;
    if (i.status === "contracted") return <button className="btn" disabled={busy} onClick={() => { const r = prompt("Operator's invoice reference to the buyer?"); if (r === null) return; act({ status: "invoiced", invoiced_at: now, invoice_ref: r }, "Invoice recorded."); }}>Operator invoiced buyer</button>;
    if (i.status === "invoiced") return <button className="btn" disabled={busy} onClick={() => { const a = prompt("Amount the operator received?"); if (a === null) return; const amt = Number(a) || 0; const fee = Math.round(amt * i.fee_pct) / 100;
      const ref = `FEE-${iso(new Date()).replace(/-/g, "")}-${i.ref.slice(-3)}`; act({ status: "fee_invoiced", buyer_paid_at: i.buyer_paid_at ?? now, money_received_at: now, amount_received: amt, fee_amount: fee, fee_invoice_ref: ref, fee_due: iso(addBusinessDays(new Date(), 5)) }, `Fee ${money(fee, i.currency ?? "USD")} due in 5 business days (${ref}). Raise the invoice from Nodus.`); }}>Money received</button>;
    if (i.status === "fee_invoiced") return <button className="btn" disabled={busy} onClick={() => act({ status: "fee_paid", fee_paid_at: now }, "Fee paid. Introduction closed.")}>Fee paid</button>;
    return null;
  })();
  return (
    <article className="card" style={{ marginBottom: 12 }}>
      <header style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between" }}>
        <strong>{i.ref} · {i.operator_company ?? "Operator"} → {i.buyer_company ?? "Buyer"}</strong>
        <span className="small muted">{i.status.replace("_", " ")} · created {fmtDateTime(i.created_at)}</span>
      </header>
      <p className="small" style={{ margin: "6px 0" }}>{i.opportunity?.headline ?? "No headline"}{i.opportunity?.region ? ` · ${i.opportunity.region}` : ""}{i.opportunity?.start ? ` · ${i.opportunity.start}` : ""}</p>
      <ol style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", listStyle: "none", padding: 0, margin: "6px 0", fontSize: 13 }}>
        {STAGES.map((st) => <li key={st.key} style={{ color: st.done(i) ? "#0E7A64" : "#8A979F" }}>{st.done(i) ? "✓" : "○"} {st.label}</li>)}
      </ol>
      {i.accepted_at && <p className="small muted" style={{ margin: "4px 0" }}>Accepted by {i.accepted_name}{i.accepted_title ? `, ${i.accepted_title}` : ""} on {fmtDateTime(i.accepted_at)}. Prior-relationship claim window ends {i.claim_deadline ? iso(addBusinessDays(new Date(i.accepted_at), 2)) : "—"}.</p>}
      {i.declined_at && <p className="small muted">Declined {fmtDateTime(i.declined_at)}{i.decline_reason ? `: ${i.decline_reason}` : ""}</p>}
      {(i.contract_value || i.fee_amount) && <p className="small" style={{ margin: "4px 0" }}>Contract {money(i.contract_value, i.currency ?? "USD")} · received {money(i.amount_received, i.currency ?? "USD")} · fee {money(i.fee_amount, i.currency ?? "USD")}{i.fee_due ? ` due ${i.fee_due}` : ""}{i.fee_invoice_ref ? ` (${i.fee_invoice_ref})` : ""}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
        {next}
        {!["fee_paid", "lost", "withdrawn", "declined"].includes(i.status) && <button className="link-btn" disabled={busy} onClick={() => act({ status: i.status === "draft" || i.status === "sent" ? "withdrawn" : "lost" }, "Closed.")}>{i.status === "draft" || i.status === "sent" ? "Withdraw" : "Mark lost"}</button>}
      </div>
    </article>
  );
}
