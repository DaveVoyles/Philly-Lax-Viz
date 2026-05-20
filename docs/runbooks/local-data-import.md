# Local Data Import Runbook

> Use this when importing data from external sources (spreadsheets, manual corrections, dedup operations)
> that only modify the local `data/lacrosse.db`.

---

## The Problem

The live site (Azure SWA + ACA) uses the DB from Azure File Share, not your local copy.
If you only run a local script, the data stays local and never reaches the live site.

---

## Standard workflow

```bash
# 1. Back up before destructive operations
cp data/lacrosse.db data/lacrosse.db.bak-$(date +%Y%m%d)

# 2. Run your import script
pnpm --filter @pll/ingest exec tsx src/scripts/applyHarritonWorkbook.ts \
  --workbook='/path/to/spreadsheet.xlsx' --db=data/lacrosse.db --apply

# 3. Verify locally
sqlite3 data/lacrosse.db ".mode column" "SELECT name, SUM(goals) FROM players p JOIN player_stats ps ON ps.player_id = p.id WHERE p.team_id = 80 GROUP BY p.id ORDER BY 2 DESC LIMIT 5"

# 4. Sync to Azure
pnpm db:upload
```

---

## Available import scripts

| Script | Purpose | Example |
|--------|---------|---------|
| `applyHarritonWorkbook.ts` | Import team spreadsheet | `--workbook=... --db=... --apply` |
| `applyCorrections.ts` | Apply community corrections | `--db=data/lacrosse.db` |
| `dedupTeams.ts` | Interactive team merge | (interactive) |
| `dedupPlayers.ts` | Interactive player merge | (interactive) |
| `seedAliasesFromAnomalies.ts` | Auto-seed team aliases | (no args) |

All scripts live in `packages/ingest/src/scripts/`.

---

## Verification checklist

After running any import:

- [ ] Query the local DB to confirm data looks correct
- [ ] Run `pnpm db:upload` (uploads to Azure File Share)
- [ ] Spot-check the live site: `curl -s "https://api.phillylaxstats.com/api/teams" | python3 -m json.tool | head -30`

---

## Common mistakes

| Mistake | Consequence | Prevention |
|---------|-------------|------------|
| Forgot `pnpm db:upload` | Data only in local DB, not on live site | Always run after any local DB write |
| Ran with `--dry-run` only | Nothing was written | Remove `--dry-run` flag for real import |
| Didn't back up first | Can't undo bad import | Always `cp` before destructive scripts |
| Ran against test DB | Changes in wrong file | Ensure `--db=data/lacrosse.db` not `.test.db` |
