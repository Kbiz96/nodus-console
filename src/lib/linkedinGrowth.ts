// LinkedIn growth buttons (audit 10 Nov 2026). Each button opens a Claude chat in the Nodus project with one job
// already typed in. Kuran presses Enter; drafts land back on Today → LinkedIn. Nothing is ever posted or sent for him.
// Pure functions only, so they can be unit-tested.

import type { Outreach } from "./types.ts";

export const NODUS_PAGE_ID = "146677052";

/** Where Kuran writes a post: his own feed, or the Nodus page admin. */
export const PERSONAL_COMPOSE_URL = "https://www.linkedin.com/feed/?shareActive=true";
export const PAGE_COMPOSE_URL = `https://www.linkedin.com/company/${NODUS_PAGE_ID}/admin/page-posts/published/?share=true`;

const HEAD = (job: string) =>
  `Nodus command: LinkedIn growth, ${job}. Use the nodus-linkedin-agent skill rules in my Chrome (Claude in Chrome), ` +
  "and read nodus/30-outreach/LINKEDIN-STANDARD.md first (sections 1 to 8; section 8 is the growth playbook).";

const SAFE =
  "Read-only and human-paced: never click Like, Comment, Connect, Message, Post or Send; at least 15 s between pages. " +
  "If LinkedIn shows a warning or limit, stop and tell me. I send and post everything myself. " +
  "Write to Supabase NODUS2 (tfsioiuvmyuqgajxtklv) only, confirm the rows landed with one count, then end with Done / Needs Kuran.";

export type GrowthKey = "comment" | "network" | "posts" | "engagers" | "magnet" | "scorecard";

export interface GrowthAction {
  key: GrowthKey;
  label: string;
  /** One short line under the button: when to press it. */
  when: string;
  prompt: string;
}

export const GROWTH_ACTIONS: GrowthAction[] = [
  {
    key: "comment",
    label: "Comment now",
    when: "Daily, before you post. 10 fresh posts to comment on.",
    prompt: [
      HEAD("comment now"),
      "Find 10 posts published in the last 3 hours (never older than 24 hours) by the section 8 comment watchlist first, then other voices in my lanes " +
        "(data-centre developers, neoclouds and GPU clouds, infrastructure funds, family offices, GPU and private-credit lenders). Skip any post I have already commented on.",
      "Draft one comment each to section 5: 2 to 3 sentences, one specific operator point, no Nodus mention. Vary the openings: never start with their name followed by " +
        "'is the right lens/answer/exercise', and no two comments share an opening shape.",
      "Exact post link is mandatory (copy-link method in the skill). Save each as outreach kind 'comment', channel 'linkedin', status 'draft', origin 'linkedin', " +
        "to_name = author, link = exact post link, note 'LI: COMMENT · posted <n>h ago · WHY: <their point> · Find the post starting: \"<first 8 words>\"'. Freshest first. 25 pages max.",
      SAFE,
    ].join("\n"),
  },
  {
    key: "network",
    label: "Grow network",
    when: "Daily. 20 ICP people to connect with, notes ready.",
    prompt: [
      HEAD("grow my network"),
      "Find 20 people to connect with today, ICP only: infrastructure-fund and family-office investment leads, data-centre developers and operators (sweet spot 5 to 100 MW), " +
        "neocloud and GPU-cloud founders and capacity heads, GPU and private-credit lenders. UK, Europe, GCC, US. 2nd-degree with mutuals first, active on LinkedIn in the last 30 days.",
      "Exclude: mega-institutions and sovereigns, anyone in my LinkedIn inbox, the CRM past New, my friends, and more than one person per company.",
      "For each, one real reason from their profile or a recent post, then a connection note of 200 characters or fewer per section 4, ending 'Kuran'. No links, no pitch.",
      "Save as outreach kind 'connect', channel 'linkedin', status 'draft', origin 'linkedin', link = profile URL, body = the note, note " +
        "'LI: <LANE> · 2nd · WHY: <reason> · If not connected, send this note first: <note>'. Upsert crm_contacts (linkedin = profile URL, source 'linkedin-agent'). 30 pages max.",
      SAFE,
    ].join("\n"),
  },
  {
    key: "posts",
    label: "Draft this week's posts",
    when: "Monday. 3 posts for you, 1 for the Nodus page.",
    prompt: [
      HEAD("draft this week's posts"),
      "Read my last 15 posts and the content analytics first (what earned comments, who viewed). Then draft 3 posts for my profile and 1 for the Nodus page, per section 8:",
      "1) Live news from the last 72 hours (DCD, Bloomberg, Reuters, FT, filings): one number in the first line, my view, dated source in the note. " +
        "2) Deal mechanics (financing, offtake, gates, GPU economics) with one worked example. " +
        "3) Lead magnet: a simple, email-gated checklist or guided tool, 'comment <KEYWORD> and I'll send it'. Page post: a short company-voice take on the strongest of the three.",
      "Rules: hook in the first two lines, 120 to 220 words, short lines, no link in the body (put the link for the first comment in the note), at most 3 hashtags at the end, " +
        "no em dashes, no 'introduce/introductions', 'deal flow', 'buyer', 'seller' or broker words, no fees, returns or 'raising', no client or site names, never imply I am new to the sector, " +
        "nothing on crypto. Not every post ends with a question. Do not reuse the 'joins / interfaces / handoffs' theme.",
      "Save each as outreach kind 'post', channel 'linkedin', status 'draft', origin 'linkedin', to_name 'Kuran (personal)' or 'Nodus Partners (page)', body = the post, note " +
        "'LI: POST · PERSONAL|PAGE · <NEWS|MECHANICS|MAGNET> · Publish <Tue|Wed|Thu> 08:00 UK · First comment: <text or link>'. Do not post anything.",
      SAFE,
    ].join("\n"),
  },
  {
    key: "engagers",
    label: "DM people who engaged",
    when: "Wednesday. Warm DMs to ICP people who reacted or commented.",
    prompt: [
      HEAD("DM people who engaged"),
      "Open my posts from the last 14 days and read who reacted, commented or reposted (and my notifications). Keep ICP only (section 8 list). " +
        "Exclude anyone in my LinkedIn inbox, the console outreach table, the CRM past New, friends, and one person per company.",
      "Research each per section 1 (profile, firm, one dated trigger). Draft a DM per section 3 whose first line picks up the actual point they made or the post they engaged with, " +
        "then one angle from the section 2 menu, then the exact sign-off. 2nd-degree people get a connection note per section 4 instead.",
      "Save as outreach kind 'dm' (or 'connect'), channel 'linkedin', status 'draft', origin 'linkedin', link = profile URL, note " +
        "'LI: <LANE> · 1st|2nd · WHY: engaged with <post first words> on <date> · Checked <date>: not in LinkedIn inbox or console outreach.' 30 pages max.",
      SAFE,
    ].join("\n"),
  },
  {
    key: "magnet",
    label: "Lead-magnet replies",
    when: "Daily while a lead-magnet post is live.",
    prompt: [
      HEAD("lead-magnet replies"),
      "Find comments from the last 14 days on my lead-magnet posts that ask for it (the keyword in the post, or 'send', 'interested', 'please share'). Skip anyone I have already replied to.",
      "For each commenter draft: (a) a short public reply, casual and human (for example 'Sent, check your DMs'), saved as outreach kind 'comment' with the exact post link and the commenter as to_name; " +
        "(b) a DM of 40 to 60 words with the email-gated link from that post's note (email first, always), then the section 3 sign-off, saved as kind 'dm' " +
        "(or 'connect' with a note if we are not connected).",
      "Notes start 'LI: MAGNET · <post first words> · WHY: asked for it on <date>'. Upsert crm_contacts with source 'linkedin-magnet'. 20 pages max.",
      SAFE,
    ].join("\n"),
  },
  {
    key: "scorecard",
    label: "Weekly scorecard",
    when: "Friday. Are impressions, comments and calls moving?",
    prompt: [
      HEAD("weekly LinkedIn scorecard"),
      "Open my creator analytics (content and audience, 7 and 28 days) and the Nodus page analytics, read-only.",
      "Report in a short table: impressions, median impressions per post, comments per post, followers gained (profile and page), follower industry mix " +
        "(share that is data-centre, energy, infrastructure or infrastructure-finance), profile views, connection notes and DMs sent this week (outreach rows marked sent), " +
        "replies, and calls booked from LinkedIn (CRM). Compare with the section 8 targets and last week.",
      "Top 3 posts with why they worked. Then three changes for next week. Save it as project doc nodus/30-outreach/linkedin/scorecard-<YYYY-MM-DD>.md. Do not draft or change anything else.",
      SAFE,
    ].join("\n"),
  },
];

export function growthAction(key: GrowthKey): GrowthAction {
  const a = GROWTH_ACTIONS.find((x) => x.key === key);
  if (!a) throw new Error(`unknown growth action ${key}`);
  return a;
}

// ---------- posts drafted for Kuran to publish ----------

/** A post draft is for the Nodus page when its note or recipient says so; otherwise it is for Kuran's own profile. */
export function postTarget(o: Pick<Outreach, "note" | "to_name">): "page" | "personal" {
  const n = `${o.note ?? ""} ${o.to_name ?? ""}`;
  return /\bPAGE\b|\(page\)|Nodus Partners page/i.test(n) ? "page" : "personal";
}

export function postComposeUrl(o: Pick<Outreach, "note" | "to_name">): string {
  return postTarget(o) === "page" ? PAGE_COMPOSE_URL : PERSONAL_COMPOSE_URL;
}

/** The text or link to put in the first comment, as the agent records it ("First comment: ..."). */
export function firstComment(note: string | null | undefined): string | null {
  const m = /First comment:\s*(.+?)\s*$/s.exec(note ?? "");
  const v = m ? m[1].replace(/^["“']|["”']$/g, "").trim() : "";
  return v && !/^(none|n\/a|-)$/i.test(v) ? v : null;
}

/** "Publish Tue 08:00 UK" from the note, if the agent gave a slot. */
export function publishSlot(note: string | null | undefined): string | null {
  const m = /Publish\s+([^·]+?)\s*(?:·|$)/.exec(note ?? "");
  return m ? m[1].trim() : null;
}

/** NEWS, MECHANICS or MAGNET from "LI: POST · PERSONAL · NEWS · ...". */
export function postType(note: string | null | undefined): string | null {
  const m = /^LI:\s*POST\s*·\s*(?:PERSONAL|PAGE)\s*·\s*([A-Z]+)/.exec((note ?? "").trim());
  return m ? m[1] : null;
}
