# Nodus console

The private web console for the Nodus Origination Engine: Focus, Review, Priorities, Map and Engine, with Today, Contacts,
Deals, Outreach, Matches, Opportunities, Organisations, Signals, Mandates, Sources, Spend, Import and Search under More.

- **Focus** (`#/`, the home screen) opens with **Signed mandates**: one large card per mandate, built from the active
  priorities (table `priorities`, progress from `priority_progress`). Priorities that share a linked deal (or the same
  title before the colon) share one card with a switch per workstream, e.g. Al-Risha offtakers and investors. Each card
  shows the paperwork from the linked deal (`deals.ncnda_signed`, `fee_signed`: "Signed", "Fee protected ✓", "NCNDA ✓"
  or "Fee letter outstanding"), the deal's next step and date (amber when overdue), progress, the next action and
  **Best in your network**: the top five people already in the CRM from `priority_network` (up to fifteen with
  "See all"), each with **Draft for me** (opens Claude with the instruction), LinkedIn and Contact. A supplier priority
  (target line Compute-Sell or Power-Sell) labels the list "Suppliers and integrators in your network" and its main
  button is **Ask Claude: get quotes** (an anonymised RFQ). The top three priorities show; the rest are one tap away.
  **Ask Claude** opens `claude.ai/new?q=…` with a ready instruction (and copies it); the small menu has preset asks.
  **Do now** is the review deck, one draft at a time, priority-tagged drafts first. **Waiting on others** (collapsed)
  lists replies with a "Draft reply with Claude" button. Calm mode (toggle in the top strip, remembered in this
  browser, on by default for Focus, Review and Priorities) hides the strip counters and the count-up and glow effects.
- **Parked drafts** (`outreach.status = 'parked'`) never appear in Review, counts, badges or LinkedIn lists. Outreach
  has a collapsed "Parked (n)" list with **Bring back**, which sets the draft back to `draft`.
- **Enrich & draft** (opportunity page, Engine panel, Matches): asks for decision makers through `enrich_request` (the
  same path as Enrich) and opens Claude to enrich with Apollo and draft first touches for approval.
- **Review** (`#/review`, `#/review?priority=<id>`): the deck on its own. Email: Approve & send (through
  `outreach_decide`; the send batch sends at 09:53, 12:53 or 15:53 UK on weekdays), Skip, Edit, Later. LinkedIn: Copy &
  open LinkedIn, then Mark sent (Kuran sends LinkedIn himself). Keys on desktop: A, S, E, C, L. There is no Undo,
  because the database has no way to take back an approval or a skip.
- **Priorities** (`#/priorities`): edit, reorder, pause, mark done, add. Writes go straight to `priorities` (RLS).
- **Today** moved to `#/today`. Map and Engine leave critical power out by default; the line toggle brings it back
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
