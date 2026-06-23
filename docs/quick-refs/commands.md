# Commands Quick Reference

> **Token cost:** ~600 tokens  
> **When to load:** Need to run scripts, dev servers, or Azure sync  
> **See also:** [onboarding.md](../onboarding.md) for conventions

---

## Core Workflow

```bash
# Install (uses pnpm@10.33.1 per packageManager pin)
pnpm install

# Dev servers (parallel)
pnpm dev                # server :3001 + web :5173, color-tagged

# Typecheck / test / build
pnpm typecheck          # strict TS across all packages
pnpm test               # vitest across all packages
pnpm build              # build all packages
```

---

## Ingest Pipeline

```bash
# RSS crawl → parse → write DB
pnpm crawl              # fetch posts → data/raw-cache/
pnpm ingest             # parse cache → data/lacrosse.db

# Full pipeline (both steps)
pnpm crawl && pnpm ingest
```

---

## PBLA (Philadelphia Box Lacrosse Association)

```bash
# Check for updates
pnpm pbla:check                    # diff live Sportability schedule vs. snapshot
pnpm pbla:check -- --save          # overwrite snapshot with live data
pnpm pbla:check -- --generate      # fetch standings + print TS snippets
pnpm pbla:check -- --verify        # compare snapshot vs. pblaData.ts (no network)
pnpm pbla:check -- --roster        # diff rosters, print missing players

# Auto-patch pblaData.ts
pnpm --filter @pll/ingest exec tsx src/scripts/patchPblaRosters.ts          # add missing players
pnpm --filter @pll/ingest exec tsx src/scripts/patchPblaRosters.ts --dry-run
pnpm --filter @pll/ingest exec tsx src/scripts/patchPblaStats.ts            # update stats
pnpm --filter @pll/ingest exec tsx src/scripts/patchPblaStats.ts --dry-run
pnpm --filter @pll/ingest exec tsx src/scripts/patchPblaData.ts             # update scores
pnpm --filter @pll/ingest exec tsx src/scripts/patchPblaData.ts --dry-run

# Sync to DB
pnpm --filter @pll/ingest exec tsx src/scripts/syncPbla.ts                  # write to lacrosse.db
pnpm --filter @pll/ingest exec tsx src/scripts/syncPbla.ts --dry-run        # preview only

# Sync YouTube videos
pnpm --filter @pll/ingest exec tsx src/scripts/syncPblaVideos.ts
pnpm --filter @pll/ingest exec tsx src/scripts/syncPblaVideos.ts --dry-run
```

---

## Data Sync & Quality

```bash
# Sync PIAA standings
pnpm --filter @pll/ingest exec tsx src/scripts/syncPiaa.ts

# Sync team logos from MaxPreps
pnpm --filter @pll/ingest sync:logos

# Sync LaxNumbers ratings
pnpm --filter @pll/ingest exec tsx src/scripts/syncLaxNumbersRatings.ts              # dry-run
pnpm --filter @pll/ingest exec tsx src/scripts/syncLaxNumbersRatings.ts --apply      # write to DB

# Data quality checks
pnpm --filter @pll/ingest exec tsx src/scripts/checkDataQuality.ts

# Apply community corrections
pnpm --filter @pll/ingest exec tsx src/scripts/applyCorrections.ts --db=data/lacrosse.db
pnpm --filter @pll/ingest exec tsx src/scripts/applyCorrections.ts --db=data/lacrosse.db --dry-run
```

---

## Deduplication

```bash
# Interactive team dedup
pnpm --filter @pll/ingest exec tsx src/scripts/dedupTeams.ts

# Interactive player dedup
pnpm --filter @pll/ingest exec tsx src/scripts/dedupPlayers.ts

# Auto-seed team aliases from anomalies
pnpm --filter @pll/ingest exec tsx src/scripts/seedAliasesFromAnomalies.ts

# Emit CSV of unknown LaxNumbers teams
pnpm --filter @pll/ingest exec tsx src/scripts/emitLaxNumbersAliasCsv.ts
```

---

## Coach Uploads & Workbooks

```bash
# Apply Harriton workbook
pnpm --filter @pll/ingest exec tsx src/scripts/applyHarritonWorkbook.ts \
  --workbook='/Users/.../HHS Lax 2026.xlsx' \
  --db=data/lacrosse.db                # dry-run preview

pnpm --filter @pll/ingest exec tsx src/scripts/applyHarritonWorkbook.ts \
  --workbook='/Users/.../HHS Lax 2026.xlsx' \
  --db=data/lacrosse.db --apply        # apply changes

# Generate upload template
pnpm --filter @pll/ingest exec tsx src/scripts/generateUploadTemplate.ts
```

---

## Hudl Integration

```bash
# Inspect Hudl DOM / selectors (headed browser)
pnpm --filter @pll/ingest sync:hudl -- --headed

# Scrape Hudl without DB writes
pnpm --filter @pll/ingest sync:hudl -- --dry-run

# Sync all active managed Hudl teams
pnpm --filter @pll/ingest sync:hudl -- --all --db=data/lacrosse.db
```

---

## Azure Sync

```bash
# Upload local DB to Azure File Share
# ⚠️ Required after any local-only DB mutation (workbooks, dedup, corrections)
pnpm db:upload
```

**When to run:**
- After `applyHarritonWorkbook.ts`
- After `dedupTeams.ts` or `dedupPlayers.ts`
- After `applyCorrections.ts` (if run manually)
- After any script that writes to `data/lacrosse.db` locally

**NOT required for:**
- Nightly CI workflows (auto-sync)
- RSS-sourced data (handled by `ingest-nightly.yml`)

---

## Web Assets

```bash
# Refresh sitemap
pnpm --filter @pll/server exec tsx src/scripts/generateSitemap.ts  # writes packages/web/public/sitemap.xml
```

---

## Per-Package Commands

```bash
# Scope to specific package
pnpm --filter @pll/ingest typecheck
pnpm --filter @pll/server dev
pnpm --filter @pll/web build
pnpm --filter @pll/ingest test
```

---

## Parse Sportability Stats (from pasted text)

```bash
# Parse player stats from pasted Sportability table
cat stats.txt | pnpm --filter @pll/ingest exec tsx src/scripts/parseSportability.ts --type=players

# Parse goalie stats
cat stats.txt | pnpm --filter @pll/ingest exec tsx src/scripts/parseSportability.ts --type=goalies
```

---

## Troubleshooting

```bash
# Check git status
git status

# Check running servers
lsof -i :3001     # server
lsof -i :5173     # web

# Kill process by PID (never use pkill/killall)
kill <PID>
lsof -ti:3001 | xargs kill

# Check DB version
sqlite3 data/lacrosse.db "PRAGMA user_version;"  # should be 23

# Verify Azure DB is mounted (when deployed)
ls -lah /data/lacrosse.db
```

---

## Common Patterns

### Full local dev workflow
```bash
pnpm install
pnpm crawl
pnpm ingest
pnpm dev
# → open http://localhost:5173
```

### Deploy data-only changes
```bash
# After local import or correction
pnpm db:upload
# → wait for nightly CI to restart ACA, or manually trigger deploy.yml
```

### Update PBLA data
```bash
pnpm pbla:check --save
pnpm --filter @pll/ingest exec tsx src/scripts/patchPblaStats.ts
pnpm --filter @pll/ingest exec tsx src/scripts/patchPblaRosters.ts
pnpm db:upload
```

---

## CI Workflows (manual trigger)

```bash
# Trigger workflow via GitHub CLI
gh workflow run sync-pbla.yml
gh workflow run deploy.yml
gh workflow run ingest-nightly.yml
```

---

**For full conventions, see:** [onboarding.md](../onboarding.md)  
**For runbook guides, see:** [runbooks/](../runbooks/)
