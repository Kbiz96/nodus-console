# Nodus console

The private web console for the Nodus Origination Engine. Three screens run the day: **Today**, **Pipeline** and
**Engine**. Everything else (Leads desk, Mandates, Priorities, Contacts, Deals, Outreach log, Daily report, Signals,
Sources, Spend, Import, Search) sits under More. Review (`#/review`) still works but is not in the nav.

- **Today** (`#/`, the home screen): the brief's headline and the sending line: "Emails go out when you press Send
  (via Apollo)." There are no scheduled sends. Below the Send deck: **Older approved (pre-27 Oct style)** (Review or
  Park all; never sent automatically) and **Sent & replies** (the `activity` action of `nodus-apollo`: replied first with
  Reply in Gmail and Move to deal, then bounced, then in sequence). **Focus session**: the brief's `do_now`, three at most, one button
  each (a Gmail link shows "Open draft in Gmail"); items with no link share one "Hand these to Claude" chat, the only
  Claude hand-off on the screen. **Replies owed**: `daily_briefs.body.replies` (`who`, `company`, `summary`,
  `gmail_draft_url`) with "Open draft in Gmail", plus replies logged in `outreach` that the brief does not mention
  ("Find in Gmail"). **Approve**: the one-at-a-time deck, emails only, research card folded under "Why this person".
  **LinkedIn**: a DM shows only when the research note says CONNECTED or the contact's notes say "LinkedIn connected";
  everyone else is a count with their connection notes (text after "If not connected, send this note first:") one tap
  away, with Copy, Open profile and Request sent. **Signed mandates**: one line each (rank, paperwork, next step, overdue
  flag), opening to the full card without Claude buttons. Rules in `src/lib/today.ts` (unit-tested).
- **Pipeline** (`#/pipeline`): open deals and warm contacts (Replied, Meeting, Qualified, NCNDA) in one list, stalled
  first (deal `next_date` today or past; contact `next_follow_up` past or empty), most overdue first. Each row: who,
  what's next, how late, **Draft the nudge** (one Claude chat that writes a Gmail draft in the existing thread) and
  **Close as dead** (deal to "Closed – lost", contact to "Nurture", with Undo).
- **Engine**: one tab bar across Map (`#/map`), Best next (`#/engine?best=1`), Matches (`#/engine`) and List
  (`#/opportunities`). The opportunity sequencer is unchanged.
- **Leads desk** (`#/leads`, under More): the full mandate cards with New leads and Best in your network, and
  Background BD. This is where leads are approved in bulk and handed to Claude for outbound.
- Claude links never ask for a paste: an instruction too long for a link is cut at a line end with a note telling
  Claude to look up the rest (`src/lib/claude.ts`). Calm mode is on by default on Today and Pipeline.
- **Parked drafts** (`outreach.status = 'parked'`) never appear in Review, counts, badges or LinkedIn lists. Outreach
  has a collapsed "Parked (n)" list with **Bring back**, which sets the draft back to `draft`.
- **Enrich & draft** (opportunity page, Engine panel, Matches): asks for decision makers through `enrich_request` (the
  same path as Enrich) and opens Claude to enrich with Apollo and draft first touches for approval.
- **Review** (`#/review`, `#/review?priority=<id>`, `#/review?old=1` for the older approved queue): the deck on its
  own. Email: Send (Apollo, now), Hold (parked with a reason: second contact at same firm, live account, later, other),
  Edit, Skip, Later; grouped by mandate with counts; one email per company (the higher-fit draft first; Send holds the
  others). LinkedIn: Copy & open LinkedIn, then Mark sent (Kuran sends LinkedIn himself). Keys on desktop: S send,
  H hold, E edit, K skip, C copy, L later. Hold has Undo.
- **Priorities** (`#/priorities`): edit, reorder, pause, mark done, add. Writes go straight to `priorities` (RLS).
- The old cockpit is the **Daily report** at `#/today` (approvals point to Today). Map and Engine leave critical power out by default; the line toggle brings it back
  (`?lines=all` on Map, `?line=all` on Engine).

- **Engine** (`#/engine`): mandates and needs on the left, opportunities on the right, one line per proposed match
  (thicker and brighter = higher score). Pick a line for the score breakdown (including what your rejections took off)
  and shortlist, reject with a reason, or send to CRM from there. `#/matches` is the same data as a list.
- **Map** (`#/map`): every opportunity on a globe, coloured by line, sized by MW, glowing if found in the last 7 days,
  with filters for line, side, region, gate and minimum MW, and a highlight of the countries live mandates look in.
  Places come from the opportunity's country and region with no outside geocoding: US state where the region names
  one, UK council or county for common UK places, otherwise the country (`src/lib/geo.ts`). The outlines are bundled
  (Natural Earth via `world-atlas`, US states via `us-atlas`); street detail fades in from CARTO's dark basemap when you
  zoom in.
- The design follows nodus.partners: tokens in `src/styles.css`, shared pieces in `src/components/ui.tsx` and
  `src/components/Brand.tsx` (the NODUS mark). Fonts (Space Grotesk, JetBrains Mono) are bundled from npm. Press `/` or
  Ctrl/Cmd-K anywhere to search. It is also the Nodus CRM (merged from the old Nodus HQ):
Today opens with drafts to approve, LinkedIn messages to send yourself, actions and deals due, then a weekly scoreboard (this week against last, UK Monday to Sunday, from the `scoreboard` database function). Rejecting a match needs a reason from a short list (`match_reject`), which the engine learns from. Outreach decisions go
through the `outreach_decide` database function; deal stages follow the gates (Protected needs NCNDA and fee signed;
Verified also needs principal, KYC and proof). `#/import` is a one-off import of the old HQ export via `crm_import`. It is a static web page (HTML, CSS and JavaScript only) published
on GitHub Pages. There is no server of our own: the page runs in your browser and talks straight to the
Nodus database on Supabase.

## What is (and is not) in this repository

- **No data.** Every opportunity, match and signal stays in the Supabase database. The page fetches it
  only after you sign in, and only into your own browser.
- **No secrets.** `src/config.ts` holds the Supabase address and the *publishable* key. Supabase designs
  publishable keys to be public: on their own they can read and change nothing.
- **The database protects itself** (migration `0006_console_security`): Row Level Security lets only
  approved email addresses read, and every change (shortlist, reject, reopen, send to CRM, move a step
  on, save a mandate, ask for decision makers, approve credits, add a person to the CRM) goes through a checked database function that applies the Nodus rules and writes the
  audit log. When the database refuses something, the console shows its message as written.
- Search engines are asked not to list it: a `noindex` tag on the page (this is the one that counts on a
  `github.io/nodus-console/` sub-path) plus a `robots.txt`, which takes effect if the site gets its own domain. The address can still be
  opened by anyone who has it, but they will only see the sign-in page.

## One-time setup

1. **GitHub Pages:** in this repository go to *Settings → Pages → Build and deployment* and set
   **Source** to **GitHub Actions**. Every push to `main` then builds and publishes the site
   (see `.github/workflows/pages.yml`). The address will be `https://<github-user>.github.io/nodus-console/`.
2. **Supabase sign-in user:** in the Supabase dashboard go to *Authentication → Users → Add user →
   Create new user*, enter `kuran@nodus.partners` and a strong password, and tick *Auto Confirm User*.
   (Only emails listed in the database's `app_users` table are approved; that one is already there.
   Anyone else who signs in sees “This account isn't approved for the Nodus console.”)
3. **Supabase address settings:** in *Authentication → URL Configuration* set **Site URL** to the Pages
   address from step 1, and add the same address to **Redirect URLs**.
4. Optional but sensible: in *Authentication → Sign In / Providers* switch off **Allow new users to sign
   up**, so only the accounts you create can sign in.

## For developers

```bash
npm ci
npm run dev       # local preview at http://localhost:5173
npm test          # unit tests for dates, numbers, filters, mandate form and gate rules
npm run build     # type-check and build into dist/
npm run smoke     # optional: browser check of the built site against fake Supabase answers
                  # (needs Playwright and Chromium installed locally). Add a folder to keep screenshots:
                  # npm run smoke -- /tmp/shots. SMOKE_SHOTS_ONLY=1 runs just the desktop and phone screenshot pass.
```

Addresses use `#/` (for example `…/nodus-console/#/opportunities`) because GitHub Pages cannot send
every address to the same page. Times are shown in UK time.
