# Incline: handbook for AI assistants and developers

Read this first. It is the source of truth for what Incline is, how it is built,
what is finished and what is left. Keep it up to date when you change things.

## What Incline is

A SaaS that audits web pages for accessibility. A visitor pastes a public URL,
Incline loads it in a real browser, runs axe-core, and turns each violation
into a plain-English explanation with steps, corrected code and a business-risk
note. Target customers: freelancers and small agencies who sell accessibility
audits to clients, and site owners checking their own pages.

- Live demo: https://incline.onrender.com (Render, auto-deploys from `main`)
- Repo: https://github.com/humayun7yz/incline
- Owner goal: a paying SaaS, around $30k a month eventually. Realistic path:
  free scan, then SEO traffic from the fix guides, then agencies paying for
  white-label reports and monitoring.
- Owner is based in Pakistan, so Stripe is NOT an option. Payments go through
  Lemon Squeezy (a merchant of record). Payouts are by bank transfer.
- There is no custom domain yet. The owner buys one once outreach shows traction.
- Rule from the owner: never invent testimonials, customer logos, reviews or
  usage statistics. There are no customers yet.

## Stack

Node 22, Express 4, Playwright (Chromium) + axe-core for scanning, Postgres via
`pg`, plain HTML/CSS/JS on the front end (no build step, no framework). The AI
step explains violations only; it never finds them (see `src/report.js`).

## Repo map

- `src/server.js`: routes, wiring. Exports `{ app, ready }`; only listens when run directly.
- `src/scan.js`: loads a URL in Chromium, runs axe-core. Re-checks every browser request against the SSRF guard.
- `src/urlsafety.js`: SSRF guard (blocks private, loopback, link-local and metadata addresses, odd ports, credentials in URLs).
- `src/limits.js`: in-memory per-IP rate limits and a concurrent-scan cap.
- `src/report.js`, `src/ai.js`: AI explanations (Anthropic, OpenAI-compatible, DeepSeek).
- `src/db.js`: Postgres access and migration runner. `migrations/*.sql` run in order at startup.
- `src/auth.js`: email and password accounts, sessions. `src/reports.js`: saved reports with per-plan history limits.
- `src/waitlist.js`: waitlist signups (file plus a `WAITLIST_SIGNUP` log line).
- `src/guides.js`, `src/pages.js`, `src/wcag.js`: server-rendered fix-guide pages from `content/rules/*.json` (82 guides).
- `public/`: `index.html` (landing), `login.html`, `signup.html`, `account.html`, `site.css` (shared design tokens), `guides.css`, and scripts `report.js` (report renderer), `nav.js` (header auth state), `app.js` (scan and waitlist), `account.js`.
- `scripts/`: `test-urlsafety.js`, `test-guides.js`, `test-accounts.js` (all run by `npm test`) and `verify-guides.js` (checks every guide's before/after code against axe-core).

## Commands

- `npm start`: run the server (port 3300 or `PORT`).
- `npm test`: URL-safety, guide-page and 57 account end-to-end checks. Must pass before every push.
- `node scripts/verify-guides.js [rule-id]`: verify guides (needs Chromium).
- Local accounts without a database: `INCLINE_MEMORY_DB=1 npm start` (data is lost on restart).

## Environment variables (set in the Render dashboard, never in the repo)

`A11Y_AI_PROVIDER` (anthropic, openai or deepseek), `A11Y_AI_KEY`, `A11Y_AI_MODEL`,
`SITE_URL` (public address, used in canonical links and the sitemap),
`DATABASE_URL` (Postgres; without it accounts are switched off and the rest of the site works),
`DATABASE_SSL` (true or false to override the automatic choice), `CHROMIUM_PATH`,
`SCAN_LIMIT_PER_10_MIN`, `SCAN_LIMIT_PER_DAY`, `MAX_CONCURRENT_SCANS`, `PORT`.
The default AI model in `src/ai.js` may be out of date; check it.

## Deployment

Pushing to `main` redeploys the live site. Working practice so far: build on a
feature branch, run `npm test`, push the branch, then fast-forward `main`
(`git push origin <branch>:main`) once it is verified. Do not change Render's
build or start commands without checking how Chromium is installed there. The
free Render web service sleeps after 15 minutes idle (about a minute to wake),
has an ephemeral disk, and cannot run background jobs reliably.
Free Render Postgres expires 30 days after creation and is then deleted, with no
backups. It is fine for testing; real customers need a paid database or another
host (the code is plain Postgres, so moving is a connection-string change).

## Security decisions (keep them)

- Scans refuse non-public addresses; do not loosen `urlsafety.js`. Any new feature that fetches a URL must use it.
- Passwords: scrypt. Sessions: random token in an httpOnly SameSite=Lax cookie; only its SHA-256 is stored. State-changing requests check `Origin`. Login failures are rate-limited per IP and per email.
- Every report query is scoped to `req.user.id`. Keep ownership checks and keep the tests for them.
- Everything from the server or the database is escaped before it goes into HTML.
- Never put secrets in the repo, in chat, or in logs.

## Conventions

- Plain, specific, sentence-case copy. No em dashes, no filler words ("simply", "just", "seamless", "leverage"). Guide prose is checked for this by `verify-guides.js`; follow it everywhere.
- The product sells accessibility, so the site itself must be accessible: semantic landmarks, visible focus, labels on every field, reduced-motion respected, and zero axe-core violations on every page at desktop and phone width. Test by running axe-core on the pages.
- Small steps. One feature per branch. Tests for anything that touches auth, money or user data. Update this file when something changes.

## Status

Done and live: scanner with SSRF protection and rate limits, 82 verified fix
guides as SEO pages with sitemap and robots.txt, landing page with pricing and
waitlist, accounts and saved reports (code is live but dormant until
`DATABASE_URL` is set).

Pricing plan (a proposal, not final): Free $0, Pro $29 a month, Agency $79 a month,
all marked "launching soon" on the site. Free accounts keep the last 5 reports;
the limits are in `PLAN_LIMITS` in `src/reports.js`. When accounts go live,
update the pricing copy to say so.

## Roadmap (suggested order)

1. Design overhaul of the whole site (landing, guides, auth, account). See the design notes below.
2. Privacy policy, terms of service and cancellation/refund pages (plain-language drafts for the owner and a lawyer to review). Needed for Lemon Squeezy and because the site collects emails.
3. Email verification and password reset. Needs an email sender (for example Resend) and, for real delivery, a verified domain.
4. Lemon Squeezy billing: checkout, webhooks that set `users.plan`, a way to manage or cancel. Test mode first.
5. PDF export of reports, then white-label reports (logo, brand colour, company name) for the Agency plan.
6. Multi-page scans (several URLs per scan, limits by plan, one browser at a time because of memory).
7. Scheduled re-scans with email alerts. Needs always-on hosting or a cron service; the free web service sleeps.
8. Later: account deletion and data export, admin view, plan-based scan limits, privacy-friendly analytics, error monitoring, paid hosting, custom domain (then set `SITE_URL`).

## Design notes

The current design is clean but generic and the owner finds it only "mid". It
uses a white page, one violet accent (`--violet` in `site.css`, taken from the
keyboard focus ring), Bricolage Grotesque for headings and Atkinson Hyperlegible
for body text (the fonts were never seen loading; verify). References the owner
likes: https://sable-agents.vercel.app (calm tone, product mockup in the hero,
how-it-works with real UI snippets, metrics band, integration chips, pricing
cards, an FAQ presented as a chat panel) and https://getpagepulse.io (plain
benefit-first copy, one clear call to action). Keep the white theme. Raise the
bar on visuals, product mockups, motion and polish, but keep copy honest.
