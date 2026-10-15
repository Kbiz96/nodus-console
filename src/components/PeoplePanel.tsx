import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { useLoad } from "../lib/useLoad.ts";
import { copyText, downloadText, enrichRequest, personCrmMark } from "../lib/data.ts";
import { fmtDate, fmtDateTime } from "../lib/format.ts";
import { friendlyError } from "../lib/rules.ts";
import {
  EMAIL_STATUS_LABEL,
  REQUEST_STATUS_LABEL,
  buildVCard,
  creditsToApprove,
  crmText,
  fmtCredits,
  isOpenRequest,
  providerLabel,
  vcfFilename,
  type CrmDetails,
  type EnrichResult,
} from "../lib/enrich.ts";
import { ENRICH_CREDITS_PER_OPPORTUNITY_ESTIMATE, ENRICH_MONTHLY_CAP_CREDITS, ENRICH_PER_RUN_CAP_CREDITS } from "../config.ts";
import ApproveCredits from "./ApproveCredits.tsx";
import { Empty, ErrorBox, ExtLink, Loading, SanctionsBadge } from "./ui.tsx";

interface Person {
  id: string;
  full_name: string | null;
  role: string | null;
  business_email: string | null;
  business_phone: string | null;
  profile_url: string | null;
  source: string | null;
  source_url: string | null;
  retrieved_at: string | null;
  sanctions_status: string | null;
  known_to_kuran: boolean | null;
  email_status: string | null;
}
export interface PersonLink {
  id: string;
  rank: number;
  why: string | null;
  found_via: string;
  warm_path: string | null;
  draft_opener: string | null;
  crm_added_at: string | null;
  people: Person | null;
}
export interface EnrichReq {
  id: string;
  status: string;
  estimated_credits: number | null;
  approved_credits: number | null;
  credits_used: number | string;
  note: string | null;
  created_at: string;
  done_at: string | null;
}

const PERSON_COLS =
  "id,full_name,role,business_email,business_phone,profile_url,source,source_url,retrieved_at,sanctions_status,known_to_kuran,email_status";

async function loadPeople(oppId: string) {
  const [links, reqs] = await Promise.all([
    supabase
      .from("opportunity_people")
      .select(`id,rank,why,found_via,warm_path,draft_opener,crm_added_at,people(${PERSON_COLS})`)
      .eq("opportunity_id", oppId)
      .order("rank")
      .limit(20)
      .then((r) => must(r) as unknown as PersonLink[]),
    supabase
      .from("enrich_requests")
      .select("id,status,estimated_credits,approved_credits,credits_used,note,created_at,done_at")
      .eq("opportunity_id", oppId)
      .order("created_at", { ascending: false })
      .limit(1)
      .then((r) => must(r) as EnrichReq[]),
  ]);
  return { people: [...links].sort((a, b) => a.rank - b.rank), latest: reqs[0] ?? null };
}

/**
 * Decision makers for one opportunity (Step 11): the Enrich button, the latest request's status,
 * and each person with warm path, contacts, draft first line and "Add to CRM".
 */
export default function PeoplePanel({
  oppId,
  heading = "People",
  oppLink = false,
  compact = false,
  refreshKey = 0,
}: {
  oppId: string;
  heading?: string;
  oppLink?: boolean;
  compact?: boolean;
  refreshKey?: number;
}) {
  const headId = useId();
  const { data, error, loading, reload } = useLoad(() => loadPeople(oppId), `${oppId}:${refreshKey}`);
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<EnrichResult[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const enrich = async () => {
    setPending(true);
    setResults(null);
    setFailure(null);
    try {
      setResults(await enrichRequest({ opp: oppId }));
      reload();
    } catch (e) {
      setFailure(friendlyError(e));
    } finally {
      setPending(false);
    }
  };

  const latest = data?.latest ?? null;
  const open = isOpenRequest(latest?.status);
  const people = data?.people ?? [];

  return (
    <section className="card stack" aria-labelledby={headId}>
      <div className="row-between wrap">
        <h2 id={headId}>{heading}</h2>
        {oppLink && <Link to={`/opportunities/${oppId}`} className="small">Open opportunity →</Link>}
      </div>
      {!compact && (
        <p className="muted small">
          Looks up 2–4 decision makers with Apollo, Clay or Vibe Prospecting. Only for Qualified or later. Uses credits (cap{" "}
          {ENRICH_PER_RUN_CAP_CREDITS} per run, {ENRICH_MONTHLY_CAP_CREDITS} a month).
        </p>
      )}

      <div className="action-row">
        <button
          className="btn"
          disabled={pending || open || (loading && !data)}
          onClick={enrich}
          title={open ? "A request for this opportunity is already open" : "Ask the next enrichment run to find decision makers"}
        >
          {people.length > 0 ? "Enrich again" : "Enrich"}
        </button>
        {pending && <span className="muted small">Asking…</span>}
      </div>
      {failure && <p className="error small" role="status">{failure}</p>}
      {results && results.length > 0 && (
        <ul className="plain" role="status">
          {results.map((r, i) => (
            <li key={i} className={r.ok ? "ok small" : "error small"}>{r.why}</li>
          ))}
        </ul>
      )}
      {latest && <RequestStatus r={latest} onChanged={reload} />}

      {error && !data ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading what="Loading people…" />
      ) : people.length === 0 ? (
        <Empty>No people found yet.</Empty>
      ) : (
        <ul className="list">
          {people.map((l) => (
            <PersonCard key={l.id} link={l} onChanged={reload} />
          ))}
        </ul>
      )}

      <p className="note">Contact details are internal. Nothing identifying leaves Nodus before Protected.</p>
    </section>
  );
}

/** One line on the latest enrichment request for this opportunity. */
export function RequestStatus({ r, onChanged }: { r: EnrichReq; onChanged?: () => void }) {
  const label = REQUEST_STATUS_LABEL[r.status] ?? r.status;
  if (r.status === "pending") {
    return (
      <p className="small">
        <span className="pill pill-wait">{label}</span> People appear after the next enrichment run.{" "}
        <span className="muted">Asked {fmtDateTime(r.created_at)}.</span>
      </p>
    );
  }
  if (r.status === "needs_approval") {
    const n = creditsToApprove(r.estimated_credits, ENRICH_CREDITS_PER_OPPORTUNITY_ESTIMATE);
    return (
      <div className="warn stack-xs">
        <p className="small">
          <strong>{label}:</strong> estimated {fmtCredits(r.estimated_credits ?? n)} credits.
        </p>
        {r.note && <p className="small">{r.note}</p>}
        <ApproveCredits id={r.id} credits={n} onDone={onChanged} />
      </div>
    );
  }
  if (r.status === "done") {
    return (
      <p className="small">
        <span className="pill pill-good">{label}</span> {fmtDateTime(r.done_at)} · {fmtCredits(r.credits_used)} credits used
        {r.note ? <span className="muted"> · {r.note}</span> : null}
      </p>
    );
  }
  return (
    <p className="small">
      <span className={`pill ${r.status === "failed" ? "pill-bad" : "pill-off"}`}>{label}</span> {fmtDateTime(r.done_at ?? r.created_at)}
      {r.note ? <span> · {r.note}</span> : null}
    </p>
  );
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^+\d]/g, "")}`;
}

function PersonCard({ link, onChanged }: { link: PersonLink; onChanged: () => void }) {
  const p = link.people;
  const sanctions = p?.sanctions_status ?? "unscreened";
  const held = sanctions !== "clear";
  const source = p?.source ? `${providerLabel(p.source)}${p.retrieved_at ? ` · retrieved ${fmtDate(p.retrieved_at)}` : ""}` : "—";

  if (!p || held) {
    return (
      <li className="list-item card person">
        <div className="list-main stack-xs">
          <div className="meta">
            <SanctionsBadge status={sanctions} />
            {p?.role && <span className="muted">{p.role}</span>}
          </div>
          <p className="warn small">Held by sanctions screening. The name and contact details stay hidden until it is cleared.</p>
          <p className="muted small">Source: {source}</p>
        </div>
      </li>
    );
  }

  const warm = p.known_to_kuran || Boolean(link.warm_path);
  return (
    <li className="list-item card person">
      <div className="list-main stack-xs">
        {warm && (
          <div className="warm-path">
            <span className="pill pill-good">{p.known_to_kuran ? "You know them" : "Warm path"}</span>
            {link.warm_path && <span>{link.warm_path}</span>}
          </div>
        )}
        <div>
          <h3>{p.full_name}</h3>
          <div className="meta">
            {p.role && <span>{p.role}</span>}
            <SanctionsBadge status={sanctions} />
          </div>
        </div>
        <dl className="facts">
          <div>
            <dt>Email</dt>
            <dd>
              {p.business_email ? (
                <>
                  <a href={`mailto:${p.business_email}`}>{p.business_email}</a>{" "}
                  <span className={`badge email-${p.email_status ?? "unknown"}`}>
                    {EMAIL_STATUS_LABEL[p.email_status ?? "unknown"] ?? p.email_status}
                  </span>
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{p.business_phone ? <a href={telHref(p.business_phone)}>{p.business_phone}</a> : "—"}</dd>
          </div>
          <div>
            <dt>LinkedIn</dt>
            <dd>{p.profile_url ? <ExtLink url={p.profile_url}>LinkedIn profile</ExtLink> : "—"}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{source}</dd>
          </div>
          <div>
            <dt>Found via</dt>
            <dd>
              {link.found_via === "public" ? (
                p.source_url ? <ExtLink url={p.source_url}>Public document</ExtLink> : "Public document"
              ) : (
                providerLabel(p.source)
              )}
            </dd>
          </div>
        </dl>
        {link.why && (
          <p className="small">
            <strong>Why this person:</strong> {link.why}
          </p>
        )}
        {link.draft_opener && <DraftBox text={link.draft_opener} />}
        <CrmButton link={link} onChanged={onChanged} />
      </div>
    </li>
  );
}

function DraftBox({ text }: { text: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <div className="draft">
      <p className="draft-label">Draft first line — for you to edit and send yourself. Nothing is sent.</p>
      <p className="draft-text">{text}</p>
      <div className="action-row">
        <button className="btn small" onClick={async () => setCopied(await copyText(text))}>Copy</button>
        {copied !== null && (
          <span className={copied ? "ok small" : "error small"} role="status">
            {copied ? "Copied." : "Could not copy in this browser. Select the text and copy it instead."}
          </span>
        )}
      </div>
    </div>
  );
}

/** "Add to CRM": gets the details to paste (copied as text, and a contact card to download) and marks the person. */
function CrmButton({ link, onChanged }: { link: PersonLink; onChanged: () => void }) {
  const [pending, setPending] = useState(false);
  const [details, setDetails] = useState<CrmDetails | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const add = async () => {
    setPending(true);
    setMsg(null);
    try {
      const d = await personCrmMark(link.id);
      setDetails(d);
      const copied = await copyText(crmText(d));
      setMsg(
        copied
          ? { ok: true, text: "Details copied. Paste them into your CRM, or download the contact card." }
          : { ok: true, text: "Here are the details. Copy them below, or download the contact card." },
      );
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: friendlyError(e) });
    } finally {
      setPending(false);
    }
  };

  const text = details ? crmText(details) : "";
  return (
    <div className="crm stack-xs">
      <div className="action-row">
        <button className="btn small" disabled={pending} onClick={add} title="Gives you the details to paste into your CRM. Nothing is sent.">
          {link.crm_added_at ? "Get CRM details again" : "Add to CRM"}
        </button>
        {link.crm_added_at && <span className="ok small">Marked as added to CRM {fmtDate(link.crm_added_at)}</span>}
        {pending && <span className="muted small">Getting details…</span>}
      </div>
      {msg && !pending && <p className={msg.ok ? "ok small" : "error small"} role="status">{msg.text}</p>}
      {details && (
        <>
          <pre className="crm-text" aria-label="Details for your CRM">{text}</pre>
          <div className="action-row">
            <button
              className="btn small"
              onClick={async () => setMsg((await copyText(text)) ? { ok: true, text: "Copied." } : { ok: false, text: "Could not copy in this browser. Select the text and copy it instead." })}
            >
              Copy details
            </button>
            <button className="btn small" onClick={() => downloadText(buildVCard(details), vcfFilename(details.name), "text/vcard")}>
              Download contact card (.vcf)
            </button>
          </div>
        </>
      )}
    </div>
  );
}
