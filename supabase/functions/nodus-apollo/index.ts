// nodus-apollo: the console's only bridge to Apollo.io.
//   send   {outreach_id, sequence?}   draft/approved email -> Apollo contact (+ custom fields) -> sequence. Marks the row sent.
//   find   {query, mandate_id?, find_request_id?}   engine matches first, then Apollo qualified against the mandate's rails
//          (criteria + card.icp): one page of company search (Apollo may count credits on some plans), then people
//          search at those companies (free, no emails). Nothing is revealed here.
//   enrich {lead_candidate_id}         reveal one business email (1 Apollo credit), only on an explicit click.
//   draft  {lead_candidate_id}         not done here: drafting stays a Claude hand-off ({ok:false, reason:'use_claude'}).
//   opportunity {text}                 new mandate card from a sentence (simple rules), then Find on it.
// Auth: the gateway verifies the JWT (verify_jwt = true); this function then asks the database whether the caller is
// on the console allow-list (nodus_is_kuran) and does every read and write as that user, under row-level security.
// The Apollo key comes from the APOLLO_API_KEY secret. It is never logged, echoed or returned.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type Criteria, type Icp, type Org, type Rails, type SeqKey, DEFAULT_TITLES, classTags, defaultIcp, headcountRanges, icpTitles, lineOf,
  nextLabel, parseOpportunity, regionLocations, scoreResult,
} from "./rails.ts";
import { toHtml } from "./html.ts";
import { activity, credits } from "./activity.ts";

const APOLLO = "https://api.apollo.io/api/v1";
const FROM_ACCOUNT_ID = "69970533e4a92b0011f30d43";

const SETUP = "Add your Apollo API key in Supabase → Edge Functions → Secrets as APOLLO_API_KEY";
const SEQUENCES: Record<SeqKey, { id: string; name: string; from: string }> = {
  capital: { id: "6ae0955be36fa500181c4307", name: "Capital / investors", from: "kuran@nodus.partners" },
  compute: { id: "6ae09565caace1000c667d73", name: "Offtake / compute / financing", from: "kuran@nodus.partners" },
  land: { id: "6ae0956d07d7cb000cd484c5", name: "Sites / land / developers", from: "kuran@nodus.partners" },
  equipment: { id: "6ae09569e36fa5001086ba18", name: "Equipment / procurement RFQ", from: "info@nodus.equipment" },
};
const FIELD = {
  subject: "6ae0ced0c95b5000180e0dfa",
  email1: "6ae0ced06814b20010e19a0f",
  email2: "6ae0ced053abcb000c5d782e",
  email3: "6ae0ced0fecca8000c28529c",
};
const BLOCKED_STAGES = ["replied", "meeting", "declined", "opted out", "bounced"];

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
/** Business outcomes come back as 200 with ok:false and a reason code, so the console can show them inline. */
const fail = (reason: string, extra: Record<string, unknown> = {}) => json(200, { ok: false, reason, ...extra });

// ---------- Apollo ----------

class ApolloError extends Error {
  constructor(public reason: string, public status: number, message: string) { super(message); }
}

let lastCall = 0;
/** At most one Apollo call every 400 ms per worker; Apollo's own limits answer 429, reported as rate_limited. */
async function apollo(key: string, path: string, opts: { method?: string; body?: unknown; query?: URLSearchParams } = {}) {
  const wait = lastCall + 400 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const url = `${APOLLO}${path}${opts.query ? `?${opts.query.toString()}` : ""}`;
  const res = await fetch(url, {
    method: opts.method ?? "POST",
    headers: { "X-Api-Key": key, "Content-Type": "application/json", "Cache-Control": "no-cache", Accept: "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const msg = String((data as { error?: unknown; message?: unknown }).error ?? (data as { message?: unknown }).message ?? text).slice(0, 300);
    const reason = res.status === 401 || res.status === 403 ? "apollo_auth" : res.status === 429 ? "rate_limited" : res.status === 422 ? "apollo_rejected" : "apollo_error";
    throw new ApolloError(reason, res.status, msg);
  }
  return data;
}

// ---------- helpers ----------

/** Plain text to Apollo's HTML (paragraphs; links only in the closing signature): see html.ts. */
export { toHtml };
/** Follow-ups written by the drafter into the note as "FU1: ..." and "FU2: ...". Nothing is invented when they are absent. */
export function followUps(note: string | null): { fu1: string | null; fu2: string | null } {
  const n = note ?? "";
  const pick = (tag: string, next: string | null) => {
    const re = new RegExp(`${tag}:\\s*([\\s\\S]*?)${next ? `(?=${next}:|\\s\\|\\s|$)` : "(?=\\s\\|\\s|$)"}`, "i");
    const m = n.match(re);
    return m && m[1].trim() ? m[1].trim() : null;
  };
  return { fu1: pick("FU1", "FU2"), fu2: pick("FU2", null) };
}
const words = (s: string | null | undefined) => (s ?? "").toLowerCase();

/** Which Apollo sequence a draft belongs to: RFQ/equipment first (it sends from info@), then the priority's line, then the text. */
export function pickSequence(text: string, line: string | null): SeqKey {
  const t = words(text);
  if (/\b(rfq|procurement|genset|gensets|turbine|turbines|equipment|quote|bom)\b/.test(t) || line === "critical_power") return "equipment";
  if (line === "capital" || /\b(investor|investors|capital|fund|equity|lp|allocation|co-invest|convertible)\b/.test(t)) return "capital";
  if (line === "powered_land" || /\b(site|sites|land|powered shell|developer|developers|campus)\b/.test(t)) return "land";
  return "compute";
}

function splitName(full: string | null): { first: string; last: string } {
  const p = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return { first: "", last: "" };
  return { first: p[0], last: p.slice(1).join(" ") };
}

// ---------- send ----------

async function send(db: SupabaseClient, key: string, b: { outreach_id?: string; sequence?: string }) {
  if (!b.outreach_id) return fail("bad_request", { message: "outreach_id is required" });
  const { data: o, error } = await db.from("outreach")
    .select("id,status,channel,to_email,to_name,company,subject,body,note,contact_id,priority_id,kind,approved_at")
    .eq("id", b.outreach_id).maybeSingle();
  if (error) return fail("db_error", { message: error.message });
  if (!o) return fail("not_found");
  if (!["draft", "approved"].includes(o.status)) return fail("wrong_status", { status: o.status });
  if (o.channel !== "email") return fail("not_email");
  if (!o.to_email) return fail("no_email");

  // Contact checks: do-not-contact, or someone already in conversation.
  let contact: { id: string; do_not_contact: boolean; stage: string | null; title: string | null; company: string | null; name: string } | null = null;
  const cq = db.from("crm_contacts").select("id,do_not_contact,stage,title,company,name");
  const { data: cs } = o.contact_id ? await cq.eq("id", o.contact_id).limit(1) : await cq.ilike("email", o.to_email).limit(1);
  contact = cs?.[0] ?? null;
  if (contact?.do_not_contact) return fail("do_not_contact");
  if (contact && BLOCKED_STAGES.includes(words(contact.stage))) return fail("contact_stage", { stage: contact.stage });

  let line: string | null = null;
  if (o.priority_id) {
    const { data: p } = await db.from("priorities").select("line").eq("id", o.priority_id).maybeSingle();
    line = (p?.line as string | null) ?? null;
  }
  const seqKey: SeqKey = (b.sequence && b.sequence in SEQUENCES) ? b.sequence as SeqKey : pickSequence(`${o.subject ?? ""} ${o.note ?? ""} ${o.kind ?? ""}`, line);
  const seq = SEQUENCES[seqKey];

  // An inactive sequence would queue the contact without sending: refuse and change nothing.
  const camp = await apollo(key, `/emailer_campaigns/${seq.id}`, { method: "GET" });
  const ec = (camp.emailer_campaign ?? camp) as { active?: boolean; name?: string };
  if (ec.active === false) return fail("sequence_inactive", { sequence: { key: seqKey, id: seq.id, name: ec.name ?? seq.name } });

  const { fu1, fu2 } = followUps(o.note);
  const fields: Record<string, string> = { [FIELD.subject]: o.subject ?? "", [FIELD.email1]: toHtml(o.body ?? "") };
  if (fu1) fields[FIELD.email2] = toHtml(fu1);
  if (fu2) fields[FIELD.email3] = toHtml(fu2);
  const { first, last } = splitName(o.to_name ?? contact?.name ?? null);

  const created = await apollo(key, "/contacts", {
    body: {
      email: o.to_email, first_name: first, last_name: last, organization_name: o.company ?? contact?.company ?? undefined,
      title: contact?.title ?? undefined, run_dedupe: true, typed_custom_fields: fields,
    },
  });
  const apolloContact = (created.contact ?? created) as { id?: string };
  if (!apolloContact.id) return fail("apollo_error", { message: "Apollo did not return a contact id" });
  // run_dedupe may hand back an existing contact without touching its fields: set them explicitly.
  await apollo(key, `/contacts/${apolloContact.id}`, { method: "PUT", body: { typed_custom_fields: fields } });

  const q = new URLSearchParams();
  q.set("emailer_campaign_id", seq.id);
  q.append("contact_ids[]", apolloContact.id);
  q.set("send_email_from_email_account_id", FROM_ACCOUNT_ID);
  q.set("send_email_from_email_address", seq.from);
  const added = await apollo(key, `/emailer_campaigns/${seq.id}/add_contact_ids`, {
    query: q,
    body: { emailer_campaign_id: seq.id, contact_ids: [apolloContact.id], send_email_from_email_account_id: FROM_ACCOUNT_ID, send_email_from_email_address: seq.from },
  });
  const skipped = (added.skipped_contact_ids ?? {}) as Record<string, unknown> | string[];
  const skippedWhy = Array.isArray(skipped) ? (skipped.includes(apolloContact.id) ? "skipped" : null) : (skipped[apolloContact.id] ?? null);
  if (skippedWhy) return fail("apollo_skipped", { detail: String(skippedWhy), contact_id: apolloContact.id, sequence: { key: seqKey, id: seq.id, name: seq.name } });

  const now = new Date().toISOString();
  const { data: upd, error: ue } = await db.from("outreach")
    .update({ status: "sent", approved_at: o.approved_at ?? now, sent_at: now, note: `${o.note ?? ""}${o.note ? " " : ""}| apollo:${seq.id} | from:${seq.from}` })
    .eq("id", o.id).in("status", ["draft", "approved"]).select("id");
  if (ue || !upd?.length) return json(200, { ok: true, warning: "Sent via Apollo but the outreach row was not updated; reload and check.", contact_id: apolloContact.id, sequence: { key: seqKey, id: seq.id, name: seq.name } });
  const missing = [fu1 ? null : "email 2", fu2 ? null : "email 3"].filter(Boolean);
  return json(200, {
    ok: true, contact_id: apolloContact.id, sequence: { key: seqKey, id: seq.id, name: seq.name, from: seq.from },
    followups_missing: missing, note: missing.length ? `No ${missing.join(" or ")} in the draft note (FU1:/FU2:); those steps are empty in Apollo.` : undefined,
  });
}

// ---------- find ----------

type Mandate = { id: string; label: string; line: string; kind: string | null; holder: string | null; criteria: Criteria | null; card: Record<string, unknown> | null };
type Person = {
  id?: string; name?: string; first_name?: string; last_name?: string; last_name_obfuscated?: string; title?: string;
  linkedin_url?: string; country?: string; has_email?: boolean; organization_id?: string; organization?: Org;
};

/** Apollo's documented form for search filters: query parameters, arrays as name[]. */
function qs(params: Record<string, string | number | boolean | string[] | undefined>): URLSearchParams {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || (Array.isArray(v) && v.length === 0)) continue;
    if (Array.isArray(v)) for (const x of v) q.append(`${k}[]`, x);
    else q.set(k, String(v));
  }
  return q;
}

/** Who the mandate is looking for: the line used for size proxies and default titles. */
function targetLine(m: Mandate | null, query: string): SeqKey {
  if (!m) return lineOf(query);
  if (m.kind === "capital_ask") return "capital";
  if (m.kind === "investor_mandate") return "land";
  if (m.kind === "site") return "compute";
  return lineOf(query, m.line);
}

async function findCore(db: SupabaseClient, key: string | undefined, b: { query?: string; mandate_id?: string; find_request_id?: string }, email: string | null) {
  const query = (b.query ?? "").trim();
  if (!query && !b.mandate_id) return { ok: false as const, reason: "bad_request", message: "query or mandate_id is required" };

  // The mandate: given, or the active mandate whose holder or asset the query names.
  const { data: ms } = await db.from("mandates").select("id,label,line,kind,holder,criteria,card").eq("active", true).limit(300);
  const all = (ms ?? []) as Mandate[];
  let mandate: Mandate | null = null;
  if (b.mandate_id) mandate = all.find((m) => m.id === b.mandate_id) ?? null;
  else {
    const toks = query.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length >= 5);
    const hits = all.filter((m) => toks.some((w) => `${m.holder ?? ""} ${String(m.card?.asset ?? "")} ${m.label}`.toLowerCase().includes(w)));
    const wantKind = lineOf(query) === "capital" ? "capital_ask" : null;
    mandate = hits.find((m) => wantKind && m.kind === wantKind) ?? hits[0] ?? null;
  }

  // The rails: the card's criteria and ICP; without a card, what the query itself says.
  const line = targetLine(mandate, query);
  const criteria: Criteria = { ...(mandate?.criteria ?? {}) };
  if (!mandate) {
    const p = parseOpportunity(query);
    if (line === "capital" && p.criteria.min_ticket_usd) criteria.min_ticket_usd = p.criteria.min_ticket_usd;
    if (p.criteria.region_pref) criteria.region_pref = p.criteria.region_pref;
  }
  const icp = ((mandate?.card?.icp ?? {}) as Icp);
  const rails: Rails = {
    line,
    criteria,
    titles: icpTitles(icp.titles).length ? icpTitles(icp.titles) : DEFAULT_TITLES[line],
    locations: regionLocations(criteria.region_pref),
    tags: classTags(criteria.class as string[] | undefined, line),
    rules: [...(criteria.exclude ?? []), ...(icp.disqualify ?? []), ...((icp.never as string[] | undefined) ?? [])].map(String),
  };
  const ranges = headcountRanges(criteria, line);

  // 1. Engine matches first.
  let engine: unknown[] = [];
  if (mandate) {
    const { data: mb } = await db.from("match_board")
      .select("match_id,tier,score,pair_type,need_side,supply_side,financing,why,mandate_code")
      .or(`mandate_id.eq.${mandate.id},counterpart_mandate_id.eq.${mandate.id}`).order("score", { ascending: false }).limit(10);
    engine = (mb ?? []).filter((r: { need_side?: { name?: string }; supply_side?: { name?: string } }) =>
      (r.need_side?.name ?? "").toLowerCase() !== (r.supply_side?.name ?? "").toLowerCase());
  }

  const notes: string[] = [];
  let people: Person[] = [];
  const orgs = new Map<string, Org>();
  if (key) {
    // 2a. Companies that fit the rails (type, region, headcount proxy for size).
    if (rails.tags.length || ranges.length) {
      try {
        const res = await apollo(key, "/mixed_companies/search", {
          query: qs({ "q_organization_keyword_tags": rails.tags, "organization_locations": rails.locations, "organization_num_employees_ranges": ranges, per_page: 25, page: 1 }),
        });
        for (const o of ((res.organizations ?? []) as Org[]).concat((res.accounts ?? []) as Org[])) if (o.id) orgs.set(o.id, o);
      } catch (e) {
        if (!(e instanceof ApolloError) || e.reason === "apollo_auth" || e.reason === "rate_limited") throw e;
        notes.push(`Company search unavailable (${e.status}); searched people by filters instead.`);
      }
    }
    // 2b. Decision makers at those companies (or by the same filters when there are none). Free; no emails.
    const base = { "person_titles": rails.titles, include_similar_titles: true, per_page: 25, page: 1 };
    const filt = orgs.size
      ? { ...base, "organization_ids": [...orgs.keys()] }
      : { ...base, "organization_locations": rails.locations, "q_organization_keyword_tags": rails.tags, "organization_num_employees_ranges": ranges };
    const res = await apollo(key, "/mixed_people/api_search", { query: qs(filt) });
    people = ((res.people ?? []) as Person[]).concat((res.contacts ?? []) as Person[]).filter((p) => p.id);
  }

  const nameOf = (p: Person) => (p.name || [p.first_name, p.last_name || p.last_name_obfuscated].filter(Boolean).join(" ")).trim();
  let excluded = 0;
  const scored = people.map((p) => {
    const o: Org | undefined = (p.organization_id && orgs.get(p.organization_id)) || p.organization;
    const s = scoreResult(p, o, rails);
    return { p, o, s };
  }).filter(({ s }) => { if (s.excluded) excluded++; return !s.excluded; });

  // Skip anyone already known: CRM, earlier leads, dismissed, or already written to.
  const companies = [...new Set(scored.map(({ o }) => o?.name).filter(Boolean))] as string[];
  const ids = scored.map(({ p }) => p.id!) as string[];
  const known = new Set<string>();
  const k = (n: string | null | undefined, c: string | null | undefined) => `${(n ?? "").toLowerCase().trim()}|${(c ?? "").toLowerCase().trim()}`;
  if (companies.length || ids.length) {
    const [cc, lc, lr, ou, nd] = await Promise.all([
      companies.length ? db.from("crm_contacts").select("name,company").in("company", companies).limit(2000) : { data: [] },
      companies.length ? db.from("lead_candidates").select("name,company").in("company", companies).limit(2000) : { data: [] },
      ids.length ? db.from("lead_candidates").select("source_ref").in("source_ref", ids).limit(500) : { data: [] },
      companies.length ? db.from("outreach").select("to_name,company").in("company", companies).limit(2000) : { data: [] },
      db.from("network_dismissals").select("contact_id").limit(5000),
    ]);
    for (const r of (cc.data ?? []) as { name: string; company: string }[]) known.add(k(r.name, r.company));
    for (const r of (lc.data ?? []) as { name: string; company: string }[]) known.add(k(r.name, r.company));
    for (const r of (lr.data ?? []) as { source_ref: string }[]) known.add(`ref:${r.source_ref}`);
    for (const r of (ou.data ?? []) as { to_name: string; company: string }[]) known.add(k(r.to_name, r.company));
    const dismissed = ((nd.data ?? []) as { contact_id: string | null }[]).map((r) => r.contact_id).filter(Boolean) as string[];
    if (dismissed.length && companies.length) {
      const { data: dc } = await db.from("crm_contacts").select("name,company").in("id", dismissed.slice(0, 1000));
      for (const r of (dc ?? []) as { name: string; company: string }[]) known.add(k(r.name, r.company));
    }
  }

  const out = scored.map(({ p, o, s }) => {
    const name = nameOf(p);
    const company = o?.name ?? null;
    const why = [`${p.title ?? "Senior"} at ${company ?? "unknown firm"}`, s.rails.length ? `rails met: ${s.rails.join(", ")}` : "no rail confirmed", mandate ? `for ${mandate.label}` : null].filter(Boolean).join("; ");
    return {
      apollo_id: p.id!, name, title: p.title ?? null, company, domain: o?.primary_domain ?? null, linkedin: p.linkedin_url ?? null,
      country: p.country ?? null, has_email: p.has_email ?? null, rails: s.rails, fit_score: s.fit_score, size_evidence: s.size_evidence, why,
      known: known.has(`ref:${p.id}`) || known.has(k(name, company)),
    };
  });
  const fresh = out.filter((p) => !p.known && p.name).sort((a, b) => b.fit_score - a.fit_score);
  const skipped = out.length - fresh.length;

  let priorityId: string | null = null;
  if (mandate) {
    const { data: pr } = await db.from("priorities").select("id").eq("status", "active").contains("mandate_ids", [mandate.id]).order("rank").limit(1);
    priorityId = pr?.[0]?.id ?? null;
  }
  let inserted: { id: string; source_ref: string }[] = [];
  if (fresh.length) {
    const rows = fresh.map((p) => ({
      priority_id: priorityId, name: p.name, title: p.title, company: p.company, company_domain: p.domain, linkedin: p.linkedin, country: p.country,
      source: "apollo-find", source_ref: p.apollo_id, status: "new", fit_score: p.fit_score,
      fit_reason: `${p.why}; size: ${p.size_evidence}`.slice(0, 600), hook: (mandate?.label ?? query) || null,
    }));
    const { data: ins } = await db.from("lead_candidates").upsert(rows, { onConflict: "priority_id,name,company", ignoreDuplicates: true }).select("id,source_ref");
    inserted = (ins ?? []) as { id: string; source_ref: string }[];
  }
  const leadId = new Map(inserted.map((r) => [r.source_ref, r.id]));
  const results = fresh.map((p) => ({ ...p, lead_candidate_id: leadId.get(p.apollo_id) ?? null }));

  if (!key) notes.push("Apollo skipped: no API key yet.");
  else notes.push("Apollo has no fund-size or MW filter: size is a headcount/revenue proxy. Check size_evidence before drafting.");
  if (excluded) notes.push(`${excluded} dropped for the card's exclude/disqualify rules.`);
  if (skipped) notes.push(`${skipped} already known (CRM, leads, dismissed or written to) and left out.`);
  const note = notes.join(" ");

  const parsed = { line, mandate_id: mandate?.id ?? null, titles: rails.titles, locations: rails.locations, tags: rails.tags, headcount: ranges, rules: rails.rules };
  const summary = {
    engine: engine.length, apollo: results.length, added: inserted.length, excluded, skipped, note,
    people: results.slice(0, 25).map((p) => ({ lead_candidate_id: p.lead_candidate_id, name: p.name, title: p.title, company: p.company, rails: p.rails, fit_score: p.fit_score, size_evidence: p.size_evidence })),
  };
  // Without an Apollo key the request stays queued for the engine's next run; otherwise it is answered.
  const status = key ? "done" : "queued";
  const recordQuery = query || mandate?.label || "";
  if (b.find_request_id) await db.from("find_requests").update({ status, parsed, results: summary, updated_at: new Date().toISOString() }).eq("id", b.find_request_id);
  else if (recordQuery) await db.from("find_requests").insert({ query: recordQuery, status, parsed, results: summary, created_by: email });

  return {
    ok: true as const, mandate: mandate ? { id: mandate.id, label: mandate.label, approach: icp.approach ?? null } : null, parsed, engine, people: results,
    added: inserted.length, excluded, skipped, note,
    ...(key ? {} : { apollo_skipped: "missing_api_key", message: SETUP }),
  };
}

async function find(db: SupabaseClient, key: string | undefined, b: { query?: string; mandate_id?: string; find_request_id?: string }, email: string | null) {
  const r = await findCore(db, key, b, email);
  return r.ok ? json(200, r) : fail(r.reason, { message: r.message });
}

// ---------- opportunity ----------

/** Kuran types an opportunity: it becomes a mandate card (kind guessed by simple rules, confidence 'stated'), then Find runs on it. */
async function opportunity(db: SupabaseClient, key: string | undefined, b: { text?: string }, email: string | null) {
  const text = (b.text ?? "").trim();
  if (text.length < 8) return fail("bad_request", { message: "Describe the opportunity in a sentence." });
  const p = parseOpportunity(text);
  const { data: labels } = await db.from("mandates").select("label").limit(2000);
  const label = nextLabel(((labels ?? []) as { label: string }[]).map((r) => r.label), p.kind, p.line);
  const { data: id, error } = await db.rpc("mandate_save", {
    p_id: null, p_label: label, p_line: p.line, p_side: p.side, p_criteria: p.criteria, p_capital_circle: false, p_active: true,
  });
  if (error || !id) return fail("db_error", { message: error?.message ?? "The mandate was not saved." });
  const today = new Date().toISOString().slice(0, 10);
  const card = { notes: `${today}: ${text}`, source: "console", icp: defaultIcp(p.kind, p.line) };
  const { error: ue } = await db.from("mandates").update({ kind: p.kind, confidence: "stated", card, active: true }).eq("id", id);
  if (ue) return fail("db_error", { message: ue.message, mandate_id: id });
  const found = await findCore(db, key, { query: text, mandate_id: id as string }, email);
  return json(200, { ok: true, created: { id, label, kind: p.kind, line: p.line, criteria: p.criteria }, find: found });
}

// ---------- enrich ----------

async function enrich(db: SupabaseClient, key: string, b: { lead_candidate_id?: string }) {
  if (!b.lead_candidate_id) return fail("bad_request", { message: "lead_candidate_id is required" });
  const { data: l } = await db.from("lead_candidates").select("id,name,title,company,linkedin,country,source,source_ref,contact_id").eq("id", b.lead_candidate_id).maybeSingle();
  if (!l) return fail("not_found");
  if (!l.source_ref || !String(l.source).startsWith("apollo")) return fail("not_apollo", { message: "This lead has no Apollo id to enrich." });
  const res = await apollo(key, "/people/match", { body: { id: l.source_ref, reveal_personal_emails: false, reveal_phone_number: false } });
  const p = (res.person ?? {}) as Person & { email?: string; email_status?: string };
  if (!p.email) return json(200, { ok: false, reason: "no_email", credits: 1, message: "Apollo had no business email for this person." });
  let contactId = l.contact_id as string | null;
  if (!contactId) {
    const { data: ex } = await db.from("crm_contacts").select("id").ilike("email", p.email).limit(1);
    contactId = ex?.[0]?.id ?? null;
  }
  if (contactId) await db.from("crm_contacts").update({ email: p.email, updated_at: new Date().toISOString() }).eq("id", contactId);
  else {
    const { data: ins, error } = await db.from("crm_contacts").insert({
      name: l.name, title: l.title ?? p.title ?? null, company: l.company ?? p.organization?.name ?? null, email: p.email,
      linkedin: l.linkedin ?? p.linkedin_url ?? null, country: l.country ?? null, source: "apollo", stage: "New",
      notes: `Email revealed via Apollo ${new Date().toISOString().slice(0, 10)} (${p.email_status ?? "status unknown"}).`,
    }).select("id").single();
    if (error) return fail("db_error", { message: error.message, email: p.email, credits: 1 });
    contactId = ins.id;
  }
  await db.from("lead_candidates").update({ contact_id: contactId }).eq("id", l.id);
  return json(200, { ok: true, email: p.email, email_status: p.email_status ?? null, contact_id: contactId, credits: 1 });
}

// ---------- entry ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { ok: false, reason: "method_not_allowed" });
  const auth = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/.test(auth)) return json(401, { ok: false, reason: "unauthorised" });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  // The console's allow-list is the app_users table: the caller's JWT email must be on it (nodus_is_kuran checks exactly that).
  const { data: u, error: ue } = await db.auth.getUser(auth.replace(/^Bearer\s+/, ""));
  const email = u?.user?.email ?? null;
  if (ue || !email) return json(401, { ok: false, reason: "unauthorised" });
  const { data: allowed, error: ae } = await db.rpc("nodus_is_kuran");
  if (ae || allowed !== true) return json(403, { ok: false, reason: "not_allowed" });

  let b: Record<string, string | undefined> = {};
  try { b = await req.json(); } catch { return fail("bad_request", { message: "JSON body expected" }); }
  const key = Deno.env.get("APOLLO_API_KEY") || undefined;
  const noKey = () => fail("missing_api_key", { message: SETUP });
  try {
    if (b.action === "send") return key ? await send(db, key, b) : noKey();
    if (b.action === "find") return await find(db, key, b, email);
    if (b.action === "enrich") return key ? await enrich(db, key, b) : noKey();
    if (b.action === "draft") return fail("use_claude", { message: "Drafting is done by Claude: use Draft, which opens a Nodus chat." });
    if (b.action === "opportunity") return await opportunity(db, key, b, email);
    if (b.action === "activity") return key ? json(200, await activity(db, (p, o) => apollo(key, p, o))) : noKey();
    if (b.action === "credits") return key ? json(200, await credits((p, o) => apollo(key, p, o))) : noKey();
    return fail("unknown_action");
  } catch (e) {
    if (e instanceof ApolloError) return fail(e.reason, { status: e.status, message: e.message });
    return fail("error", { message: e instanceof Error ? e.message.slice(0, 300) : "unexpected error" });
  }
});
