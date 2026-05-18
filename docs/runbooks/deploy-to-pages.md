# Deploy to GitHub Pages

> Use this runbook whenever you need to make code or data changes visible on the live site at
> https://davevoyles.github.io/Philly-Lax-Viz/

---

## Key fact: Push to `main` does NOT trigger a deploy

The `pages.yml` workflow only triggers on:

1. **`workflow_dispatch`** (manual trigger)
2. **`ingest-nightly` workflow completion** (automatic, runs nightly)

Code-only pushes to `main` will **not** appear on the live site until the next nightly run or a manual dispatch.

---

## How to deploy after pushing code changes

```bash
# Push your changes to main first
git push origin main

# Then trigger the Pages workflow
gh workflow run pages.yml --ref main

# Monitor progress
gh run list --workflow=pages.yml --limit=3
gh run watch <RUN_ID> --exit-status
```

---

## How to deploy after local data changes

If you ran a local script that modified `data/lacrosse.db` (workbook imports, dedup, corrections):

```bash
# One command: uploads DB to Azure + triggers Pages redeploy
pnpm db:deploy
```

This is equivalent to:

```bash
pnpm db:upload                    # upload local DB to Azure File Share
gh workflow run pages.yml --ref main   # trigger Pages rebuild from Azure DB
```

---

## What the Pages workflow does

1. Checks out `main`
2. Downloads `lacrosse.db` from Azure File Share
3. Runs `pnpm export:static` (generates JSON snapshots from DB)
4. Runs `pnpm --filter @pll/server validate:export` (sanity checks)
5. Builds the web package with `VITE_STATIC_MODE=true`
6. Deploys to the `gh-pages` branch

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Live site shows old code | Push doesn't trigger deploy | Run `gh workflow run pages.yml --ref main` |
| Live site shows old data | Azure DB not updated | Run `pnpm db:deploy` |
| Workflow fails at "Download DB" | Azure File Share unreachable | Check `AZURE_STORAGE_CONNECTION_STRING` secret in repo settings |
| Pages shows blank page | Missing IS_STATIC guard in new view | Add `staticUnavailableNode()` fallback (see AGENTS.md section 10) |
| PWA serves stale content | Service worker cache | Users see new content on second visit (auto-update) |

---

## Verifying a deploy

```bash
# Check that the workflow completed
gh run list --workflow=pages.yml --limit=1

# Verify live content (cache-bust with query param)
curl -s "https://davevoyles.github.io/Philly-Lax-Viz/data/2026/teams/80.json?v=$(date +%s)" | head -20
```
