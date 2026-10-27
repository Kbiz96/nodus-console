import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { useLoad } from "../lib/useLoad.ts";
import { actionSetStatus } from "../lib/data.ts";
import { compareActions, fmtDay, gateScore, isClosed, isOverdue, ukToday } from "../lib/crm.ts";
import { fmtNumber } from "../lib/format.ts";
import { friendlyError } from "../lib/rules.ts";
import type { CrmAction, Deal, Outreach } from "../lib/types.ts";
import { Empty, ErrorBox, ExtLink, Loading } from "./ui.tsx";

export const OUTREACH_COLS =
  "id,kind,channel,contact_id,to_name,to_email,company,subject,body,link,sequence_step,status,note,origin,created_at,approved_at,sent_at,replied_at,priority_id";
export const DEAL_COLS =
  "id,deal,contact_id,counterparty,line,heat,rank,stage,principal_verified,ncnda_signed,fee_signed,kyc_done,proof_done,next_date,next_step,value,terms,notes,updated_at";
const SHOW_DRAFTS = 50;

async function load() {
  const today = ukToday();
  const [drafts, manual, actions, deals] = await Promise.all([
    supabase.from("outreach").select(OUTREACH_COLS, { count: "exact" }).eq("status", "draft").order("created_at", { ascending: false }).limit(SHOW_DRAFTS)
      .then((r) => ({ rows: must(r) as unknown as Outreach[], total: r.count ?? 0 })),
    supabase.from("outreach").select(OUTREACH_COLS).eq("status", "manual").order("approved_at", { ascending: true, nullsFirst: false }).limit(100)
      .then((r) => must(r) as unknown as Outreach[]),
    supabase.from("crm_actions").select("id,title,detail,priority,due,category,status,contact_id,deal_id,link,focus_rank").eq("status", "open").limit(300)
      .then((r) => (must(r) as unknown as CrmAction[]).sort(compareActions)),
    supabase.from("deals").select(DEAL_COLS).lte("next_date", today).order("next_date", { ascending: true }).limit(300)
      .then((r) => (must(r) as unknown as Deal[]).filter((d) => !isClosed(d.stage))),
  ]);
  return { drafts, manual, actions, deals, today };
}

/** The CRM part of the Daily report: a pointer to approvals (they live on Today), actions and deals due. */
export default function TodayCrm() {
  const { data, error, loading, reload } = useLoad(load, "today-crm");
  const [actMsg, setActMsg] = useState<{ id: string; text: string } | null>(null);

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Loading what="Loading your queue…" />;
  if (!data) return null;
  const { drafts, manual, actions, deals, today } = data;

  const setAction = async (a: CrmAction, status: "done" | "dismissed") => {
    setActMsg(null);
    try {
      await actionSetStatus(a.id, status);
      reload();
    } catch (e) {
      setActMsg({ id: a.id, text: friendlyError(e) });
    }
  };

  return (
    <>
      <section className="stack">
        <div className="sec-title"><h2>Approvals</h2></div>
        <p className="muted small">
          {drafts.total + manual.length === 0
            ? "Nothing waiting for approval."
            : `${fmtNumber(drafts.total)} ${drafts.total === 1 ? "draft" : "drafts"} and ${fmtNumber(manual.length)} LinkedIn ${manual.length === 1 ? "message" : "messages"} wait for you. `}
          <Link to="/">Send on Today</Link>
        </p>
      </section>

      <section className="stack">
        <div className="sec-title"><h2>Do these first ({fmtNumber(actions.length)})</h2></div>
        {actions.length === 0 ? (
          <Empty>No open actions.</Empty>
        ) : (
          <ul className="list">
            {actions.map((a) => (
              <li key={a.id} className="list-item">
                <input type="checkbox" className="tick" checked={false} aria-label={`Mark “${a.title ?? "action"}” done`} onChange={() => setAction(a, "done")} />
                <div className="list-main">
                  <strong>{a.title || "(untitled action)"}</strong>
                  {a.detail && <p className="small muted">{a.detail}</p>}
                  <div className="meta">
                    {a.priority && <span className={`badge prio-${a.priority.toLowerCase()}`}>{a.priority}</span>}
                    {a.category && <span className="badge">{a.category}</span>}
                    {a.due && <span className={isOverdue(a.due, today) ? "error" : "muted"}>Due {fmtDay(a.due)}</span>}
                    {a.contact_id && <Link to={`/contacts?id=${a.contact_id}`}>Contact</Link>}
                    {a.deal_id && <Link to={`/deals?id=${a.deal_id}`}>Deal</Link>}
                    {a.link && <ExtLink url={a.link}>Link</ExtLink>}
                  </div>
                  {actMsg?.id === a.id && <p className="error small" role="alert">{actMsg.text}</p>}
                </div>
                <button className="btn small ghost" type="button" onClick={() => setAction(a, "dismissed")}>Dismiss</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stack">
        <div className="sec-title"><h2>Deals due ({fmtNumber(deals.length)})</h2></div>
        {deals.length === 0 ? (
          <Empty>No deals due today.</Empty>
        ) : (
          <ul className="list">
            {deals.map((d) => (
              <li key={d.id} className="list-item">
                <div className="list-main">
                  <Link to={`/deals?id=${d.id}`} className="strong">{d.deal || d.counterparty || "(unnamed deal)"}</Link>
                  <div className="meta">
                    {d.line && <span className="badge">{d.line}</span>}
                    {d.heat && <span className={`badge heat-${d.heat.toLowerCase()}`}>{d.heat}</span>}
                    {d.stage && <span className="badge">{d.stage}</span>}
                    <span className="muted">gates {gateScore(d)}/5</span>
                    <span className={isOverdue(d.next_date, today) ? "error" : "muted"}>{fmtDay(d.next_date)}</span>
                  </div>
                  {d.next_step && <p className="small">{d.next_step}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
