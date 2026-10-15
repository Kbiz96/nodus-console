# Nodus console

The private web console for the Nodus Origination Engine: Today, Matches, Opportunities, Organisations,
Signals, Mandates, Sources and Search. It is a static web page (HTML, CSS and JavaScript only) published
on GitHub Pages. There is no server of our own: the page runs in your browser and talks straight to the
Nodus database on Supabase.

## What is (and is not) in this repository

- **No data.** Every opportunity, match and signal stays in the Supabase database. The page fetches it
  only after you sign in, and only into your own browser.
- **No secrets.** `src/config.ts` holds the Supabase address and the *publishable* key. Supabase designs
  publishable keys to be public: on their own they can read and change nothing.
- **The database protects itself** (migration `0006_console_security`): Row Level Security lets only
  approved email addresses read, and every change (shortlist, reject, reopen, send to CRM, move a step
  on, save a mandate) goes through a checked database function that applies the Nodus rules and writes the
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
                  # (needs Playwright and Chromium installed locally)
```

Addresses use `#/` (for example `…/nodus-console/#/opportunities`) because GitHub Pages cannot send
every address to the same page. Times are shown in UK time.
