// nodus-apollo actions that read Apollo back: `activity` (what happened to the emails Nodus enrolled) and `credits`.
// Kept apart from index.ts so the send/find code is untouched. Pure helpers here are unit-tested from the console.

export type ApolloCall = (path: string, opts?: { method?: string; body?: unknown; query?: URLSearchParams }) => Promise<Record<string, unknown>>;

export interface OutRow {
  id: string; to_email: string | null; to_name: string | null; company: string | null; contact_id: string | null;
  status: string; sent_at: string | null; replied_at: string | null; note: string | null; priority_id: string | null;
}
export interface Msg {
  id: string; contact_id?: string | null; emailer_campaign_id?: string | null; to_email?: string | null; status?: string | null;
  replied?: boolean | null; bounce?: boolean | null; completed_at?: string | null; due_at?: string | null; reply_class?: string | null;
}
export type SeqStatus = "active" | "paused" | "finished" | "failed" | "unknown";
export interface ActivityRow {
  outreach_id: string; contact_id: string | null; to_email: string; to_name: string | null; company: string | null; sent_at: string | null;
  sequence_id: string | null; apollo_contact_id: string | null; sequence_status: SeqStatus;
  sent: number; opens: number; replied: boolean; bounced: boolean; reply_class: string | null; lane: "replied" | "bounced" | "in_sequence";
}

/** The Apollo sequence id the send wrote into the note ("| apollo:<id> |"). */
export function seqFromNote(note: string | null | undefined): string | null {
  const m = (note ?? "").match(/apollo:([0-9a-f]{24})/i);
  return m ? m[1] : null;
}

/** One row per enrolled outreach: Apollo's messages for that address in that sequence, plus the contact's sequence status. */
export function summarise(rows: OutRow[], msgs: Msg[], opened: Set<string>, statuses: Map<string, Map<string, SeqStatus>>): ActivityRow[] {
  const byEmail = new Map<string, Msg[]>();
  for (const m of msgs) {
    const e = (m.to_email ?? "").toLowerCase().trim();
    if (!e) continue;
    if (!byEmail.has(e)) byEmail.set(e, []);
    byEmail.get(e)!.push(m);
  }
  const out: ActivityRow[] = [];
  for (const r of rows) {
    const email = (r.to_email ?? "").toLowerCase().trim();
    if (!email) continue;
    const seq = seqFromNote(r.note);
    const mine = (byEmail.get(email) ?? []).filter((m) => !seq || !m.emailer_campaign_id || m.emailer_campaign_id === seq);
    const apolloContact = mine.find((m) => m.contact_id)?.contact_id ?? null;
    const sent = mine.filter((m) => m.status === "completed" || Boolean(m.completed_at)).length;
    const opens = mine.filter((m) => opened.has(m.id)).length;
    const replied = mine.some((m) => m.replied === true) || r.status === "replied";
    const bounced = mine.some((m) => m.bounce === true);
    const reply_class = mine.find((m) => m.replied && m.reply_class)?.reply_class ?? null;
    let sequence_status: SeqStatus = (apolloContact && seq && statuses.get(apolloContact)?.get(seq)) || "unknown";
    if (sequence_status === "unknown") {
      // Without the contact's own status: scheduled steps mean it is still running; a reply or bounce ends it.
      if (replied || bounced) sequence_status = "finished";
      else if (mine.some((m) => m.status === "scheduled" || m.status === "drafted")) sequence_status = "active";
      else if (mine.length) sequence_status = "finished";
    }
    out.push({
      outreach_id: r.id, contact_id: r.contact_id, to_email: email, to_name: r.to_name, company: r.company, sent_at: r.sent_at,
      sequence_id: seq, apollo_contact_id: apolloContact, sequence_status, sent, opens, replied, bounced, reply_class,
      lane: replied ? "replied" : bounced ? "bounced" : "in_sequence",
    });
  }
  const rank = { replied: 0, bounced: 1, in_sequence: 2 } as const;
  return out.sort((a, b) => rank[a.lane] - rank[b.lane] || String(b.sent_at ?? "").localeCompare(String(a.sent_at ?? "")));
}

/** Apollo's contact_campaign_statuses → status per sequence id. */
export function campaignStatuses(contact: Record<string, unknown> | null | undefined): Map<string, SeqStatus> {
  const m = new Map<string, SeqStatus>();
  const list = (contact?.contact_campaign_statuses ?? []) as { emailer_campaign_id?: string; status?: string }[];
  for (const s of Array.isArray(list) ? list : []) {
    if (!s?.emailer_campaign_id) continue;
    const st = String(s.status ?? "").toLowerCase();
    m.set(s.emailer_campaign_id, st === "active" || st === "paused" || st === "finished" || st === "failed" ? st : "unknown");
  }
  return m;
}

/** Credits left from Apollo's credit_usage_stats: the lead (email) credit pool first. */
export function creditSummary(res: Record<string, unknown>): { left: number | null; limit: number | null; consumed: number | null; cycle_end: string | null } {
  const stats = (res.credit_usage_stats ?? {}) as Record<string, { limit?: number; consumed?: number; left_over?: number }>;
  const lead = stats.lead_credit ?? null;
  const cycle = (res.current_credit_cycle ?? {}) as Record<string, unknown>;
  const end = (cycle.end_date ?? cycle.end ?? cycle.ends_at ?? cycle.cycle_end ?? null) as string | null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  return { left: n(lead?.left_over), limit: n(lead?.limit), consumed: n(lead?.consumed), cycle_end: end ? String(end) : null };
}

const SEQ_IDS = ["6ae0955be36fa500181c4307", "6ae09565caace1000c667d73", "6ae0956d07d7cb000cd484c5", "6ae09569e36fa5001086ba18"];
const MAX_PAGES = 5;
const MAX_CONTACT_LOOKUPS = 40;

async function searchMessages(call: ApolloCall, seqIds: string[], stats: string[] | null, since: string): Promise<Msg[]> {
  const out: Msg[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams();
    for (const id of seqIds) q.append("emailer_campaign_ids[]", id);
    if (stats) for (const s of stats) q.append("emailer_message_stats[]", s);
    q.set("emailer_message_date_range_mode", "due_at");
    q.set("emailer_message_date_range[min]", since);
    q.set("per_page", "100");
    q.set("page", String(page));
    const res = await call("/emailer_messages/search", { method: "GET", query: q });
    const msgs = (res.emailer_messages ?? []) as Msg[];
    out.push(...msgs);
    if (msgs.length < 100) break;
  }
  return out;
}

// deno-lint-ignore no-explicit-any
type Db = any;

/**
 * `activity`: the outreach rows sent through Apollo in the last 30 days, with what Apollo saw (sequence status, opens,
 * replies, bounces). A reply Apollo has seen is written back: outreach → replied (with replied_at) and the CRM contact →
 * stage Replied (never moving a contact back from a later stage).
 */
export async function activity(db: Db, call: ApolloCall) {
  const since = new Date(Date.now() - 30 * 24 * 3600e3);
  const { data, error } = await db.from("outreach")
    .select("id,to_email,to_name,company,contact_id,status,sent_at,replied_at,note,priority_id")
    .like("note", "%apollo:%").gte("sent_at", since.toISOString()).in("status", ["sent", "replied"])
    .order("sent_at", { ascending: false }).limit(300);
  if (error) return { ok: false as const, reason: "db_error", message: error.message };
  const rows = (data ?? []) as OutRow[];
  if (!rows.length) return { ok: true as const, rows: [] as ActivityRow[], updated: 0, checked_at: new Date().toISOString() };

  const seqIds = [...new Set(rows.map((r) => seqFromNote(r.note)).filter(Boolean) as string[])];
  const ids = seqIds.length ? seqIds : SEQ_IDS;
  const day = since.toISOString().slice(0, 10);
  const all = await searchMessages(call, ids, null, day);
  const opened = new Set((await searchMessages(call, ids, ["opened", "clicked"], day)).map((m) => m.id));

  // Each enrolled person's own sequence status (active / paused / finished), from their Apollo contact.
  const wanted = new Set(rows.map((r) => (r.to_email ?? "").toLowerCase()));
  const contactIds = [...new Set(all.filter((m) => wanted.has((m.to_email ?? "").toLowerCase()) && m.contact_id).map((m) => m.contact_id as string))];
  const statuses = new Map<string, Map<string, SeqStatus>>();
  for (const cid of contactIds.slice(0, MAX_CONTACT_LOOKUPS)) {
    try {
      const res = await call(`/contacts/${cid}`, { method: "GET" });
      statuses.set(cid, campaignStatuses((res.contact ?? res) as Record<string, unknown>));
    } catch {
      /* status falls back to what the messages show */
    }
  }

  const result = summarise(rows, all, opened, statuses);

  // Write replies back (outreach and CRM), once.
  let updated = 0;
  const now = new Date().toISOString();
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const a of result.filter((x) => x.lane === "replied")) {
    const r = byId.get(a.outreach_id);
    if (!r || r.status === "replied") continue;
    const { data: up } = await db.from("outreach").update({ status: "replied", replied_at: r.replied_at ?? now })
      .eq("id", r.id).eq("status", "sent").select("id");
    if (up?.length) updated++;
    const later = ["Replied", "Meeting", "Qualified", "NCNDA", "Closed – won", "Closed – lost", "Nurture"];
    const notLater = `stage.is.null,stage.not.in.(${later.map((s) => `"${s}"`).join(",")})`;
    const cq = db.from("crm_contacts").update({ stage: "Replied", last_activity: now.slice(0, 10), updated_at: now });
    if (r.contact_id) await cq.eq("id", r.contact_id).or(notLater);
    else if (r.to_email) await cq.ilike("email", r.to_email).or(notLater);
  }
  return { ok: true as const, rows: result, updated, checked_at: now };
}

/** `credits`: Apollo's credit usage for this billing cycle (costs nothing). */
export async function credits(call: ApolloCall) {
  const res = await call("/usage_stats/credit_usage_stats", { method: "POST", body: {} });
  return { ok: true as const, ...creditSummary(res) };
}
