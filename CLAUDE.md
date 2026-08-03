# CLAUDE.md

## Environment notes

### Pull requests / GitHub API
- `gh` CLI is installed (v2.63.2), but **cannot create PRs from this sandbox**:
  - No GitHub auth token is present (`GH_TOKEN`/`GITHUB_TOKEN` unset) and `gh auth login` is interactive.
  - `api.github.com` and `cli.github.com` return 403 through the sandbox proxy. `github.com` itself (200) and `git push` via the local proxy work fine.
- To open a PR, push the branch and use the browser compare URL:
  `https://github.com/mitch1114/Inventory-Management-System/compare/main...<branch>?expand=1`

### Git
- Development branch: `claude/inventory-management-system-jlcmc` (push branches must start with `claude/`).
- Push with `git push -u origin <branch>`.

## Authentication (gate access)
- Login is enforced **only when Supabase is configured** (`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`). Without them the app runs unauthenticated against localStorage (local/demo mode).
- Client code: `src/lib/auth.js` (Supabase Auth wrappers), `src/components/Login.jsx` (login screen), gating + sign-out in `src/App.jsx`.
- The login screen is **UX gating**. Real security requires Row Level Security on the data table — do the Supabase setup below or the data is still reachable via the anon key.

### Required Supabase setup (run once in the Supabase dashboard)
1. **Create users**: Authentication → Users → "Add user" (set email + password). The app has no public signup by design.
2. **Disable public signups**: Authentication → Providers/Settings → turn off "Allow new users to sign up".
3. **Lock down the data table** (SQL editor):
   ```sql
   alter table app_state enable row level security;

   create policy "authenticated read" on app_state
     for select to authenticated using (true);

   create policy "authenticated write" on app_state
     for insert to authenticated with check (true);

   create policy "authenticated update" on app_state
     for update to authenticated using (true) with check (true);
   ```
   This makes `app_state` readable/writable only by signed-in users (shared company data — not per-user).

## Project state (updated Aug 2026 — read me first in new sessions)

### What this is
Production inventory/order system for ACC Crappie Stix, live daily at
`acc-ops.vercel.app` (soon `ops.acccrappiestix.com`). Team uses logins
(Supabase Auth). Deploy flow: commit to the dev branch → push → user
merges the GitHub compare-URL PR → Vercel auto-deploys. ALWAYS remind
the user to merge; pushed ≠ deployed.

### Architecture quick map
- SPA state: one JSON doc in Supabase `app_state` row id "main"
  (localStorage fallback). Backups: `app_state_backups` table,
  snapshotted by the cron. Realtime sync via Supabase channel.
- Serverless (Vercel, Hobby 12-function cap — currently 7):
  `api/qbo.js` + `api/shipstation.js` are dispatchers (?action=) over
  handlers in `/server`; plus `api/claude/analyze.js`,
  `api/notify/shipped.js`, `api/notify/stage.js`, `api/parse-po.js`
  (AI PDF supplier POs), `api/cron/shipstation-pull.js` (6am/10pm CT
  inventory pull + data snapshot; needs SUPABASE_SERVICE_ROLE_KEY).
- Key libs: `parseAccOrderWriter.js` (label-anchored order-writer
  parser; 2025/2026/2027 dealer/distributor/buying-group layouts, tips
  sections incl. N/A-UPC + rod-SKU derivation), `inventory.js`
  (available = onHand − locked; advanceStage; resolveBackorders
  fill-&-kill vs split; autoAllocate), `landedCost.js`, `scan.js`
  (UPC-A/EAN-13 normalization + decoder config), `notify.js`.

### Automation at stages
Import PO → order Confirmed (notif rules fire) → print pick sheet from
board card → Picked & Packed: push to ShipStation (orderKey=order.id,
orderNumber=dealerPORef, parsed address, customer email/phone) → Booked:
QBO invoice auto-created unsent (when QBO connected) → tracking
auto-syncs every 5 min on board → Shipped: customer email + team notifs.

### Env vars (Vercel)
VITE_SUPABASE_URL/_ANON_KEY (browser), SUPABASE_URL +
SUPABASE_SERVICE_ROLE_KEY + CRON_SECRET (cron), SHIPSTATION_API_KEY/
_SECRET (V1), SHIPSTATION_V2_API_KEY, RESEND_API_KEY +
NOTIFY_FROM_EMAIL, ANTHROPIC_API_KEY, INTUIT_CLIENT_ID/_SECRET (QBO).

### Open items
- QBO OAuth app not yet created (Intuit portal); invoice auto-create
  silently skips until connected. Redirect URI must match live domain.
- DNS pending with dev agency (Cloudflare): Resend email records +
  CNAME `ops` → cname.vercel-dns.com. Resend unverified until then.
- Cycle Count tab hidden (commented out in App.jsx nav) — "Warehouse
  Mode" (BT scanner-gun input + phone-first pick screen) on hold.
- Known deferred: multi-user last-write-wins on the single JSON doc
  (needs versioned saves before heavy concurrent editing); mobile
  layout is desktop-first outside the warehouse flows.
- Business plan: user is productizing this (Claude Project has the
  Product Brief); Triumph Systems repo copy planned via GitHub
  template.

### Working conventions
- Verify changes in the running app (Playwright + chromium at
  /opt/pw-browsers) before pushing; test parsers against real uploaded
  order-writer files when available.
- Never suggest Settings → Clear All Data / Load Demo Data on prod.
- Demo data (makeDemoData) uses relative dates — keep it that way.
