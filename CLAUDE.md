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
