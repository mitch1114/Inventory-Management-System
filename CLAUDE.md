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
