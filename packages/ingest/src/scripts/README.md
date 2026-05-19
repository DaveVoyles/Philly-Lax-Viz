# Ingest Scripts

Operational scripts for the Philly Lacrosse data pipeline. All scripts are
idempotent and dry-run by default — pass `--apply` to mutate the DB.

Run from the repo root via `pnpm --filter @pll/ingest exec tsx src/scripts/<name>.ts [flags]`
or via the named npm scripts in `packages/ingest/package.json`.

## Pattern

The audit/cleanup idiom (used by every `audit*`, `clean*`, `dedup*`,
`reattribute*`, and seed script):

1. **Dry-run by default.** Print every candidate row + intended action; no DB writes.
2. **`--apply` commits.** All mutations wrapped in a single `BEGIN…COMMIT`; `PRAGMA foreign_key_check` after.
3. **Idempotent.** Re-running is a no-op; existing rows are detected and skipped.
4. **Anomalies persist.** Detection-only scripts INSERT into the `ingest_anomalies`
   table (with a deterministic `raw_line` key) so re-runs don't double-log and so
   `/api/anomalies?strategy=…` can surface findings to the web UI.
5. **DB path.** Honors `DB_PATH` (preferred) or `PLL_DB_PATH`, falling back to `data/lacrosse.db`.

## Audit / detection (read-only by default)

### `auditStatAnomalies.ts`
Flag + clamp impossible per-game stat values caused by parser over-greediness on
parenthetical career milestones (e.g. `1G (Set School record 173 Goals)` → 174G).
Records `stat-cap-exceeded` rows in `ingest_anomalies`, clamps the offending
column to 0, deletes rows that become empty. Also strips trailing `:;,` from
player names. Run: `pnpm --filter @pll/ingest exec tsx src/scripts/auditStatAnomalies.ts [--apply]`.

### `auditCrossChecks.ts`
Cross-validation audit (2026 season). Detection-only; writes `cross-check-*`
rows to `ingest_anomalies` for things like `player_goals > team_score` and
season-concentration outliers. Never mutates `players` / `player_stats`.
Run: `pnpm --filter @pll/ingest exec tsx src/scripts/auditCrossChecks.ts [--apply]`.

### `auditShortNames.ts` (Wave H0)
Print `{id, name, team, game_count, recap_url}` for each ≤4-char single-token
player so a human can decide keep / delete / rename. Dry-run only — no
auto-delete. Run: `pnpm --filter @pll/ingest exec tsx src/scripts/auditShortNames.ts`.

### `scanCareerProse.ts`
Read-only scan of cached recap HTML (`data/raw-cache/`) for player-stat lines
whose trailing parentheticals smell like career/historical prose. Buckets
findings into `parsed-and-clean` / `parsed-and-suspect` / `not-parsed` and
writes `.github/docs/2026-04-22-prose-scan-report.json`. Used to tune
`PROSE_MARKERS` in `parsers/text.ts`. Run: `pnpm --filter @pll/ingest exec tsx src/scripts/scanCareerProse.ts`.

### `anomalyTriage.ts`
Read-only summary of `ingest_anomalies`: groups by `(strategy, reason)`,
attaches up to 5 sample raw lines + post URLs, and tags each group with an
S/M/L fix-difficulty. Output: `data/anomaly-triage.md`. Run: `pnpm --filter
@pll/ingest anomaly:triage`. Flags: `--db PATH`, `--out PATH`, `--top N`.

## Seeding

### `seedTeamAliases.ts`
Bootstrap `team_aliases` for PIAA-name variants (e.g. `springford → Spring-Ford`,
`hatborohorsham → Hatboro-Horsham`). Run: `pnpm --filter @pll/ingest aliases:seed [-- --apply]`.

### `seedTeamBranding.ts`
Hand-curated `primary_color` / `secondary_color` / `nickname` for the top ~30
teams by 2026 game count (populates migration 008 columns). Run:
`pnpm --filter @pll/ingest branding:seed [-- --apply]`.

### `seedPlayerAliases.ts`
Manual player-merge aliases (calls `mergePlayers()` from `dedupPlayers`).
Idempotent — already-merged pairs are no-ops. Run: `pnpm --filter @pll/ingest
player-aliases:seed [-- --apply]`.

### `applyHarritonWorkbook.ts`
Harriton-only workbook importer for parent-provided XLSX stats. Reads a local
`.xlsx` file, maps opponent sheets to Harriton games, maps player names to
existing Harriton players (auto-creates high-confidence missing players, skips
ambiguous rows), then replaces Harriton `player_stats` rows for mapped games.
Dry-run by default. Run:
`pnpm --filter @pll/ingest exec tsx src/scripts/applyHarritonWorkbook.ts --workbook=/path/to/HHS\\ Lax\\ 2026.xlsx --db=data/lacrosse.db [--apply]`.

### `seedTestDb.ts`
Build the frozen, tiny, deterministic `data/lacrosse.test.db` from the real
migration files (~5 teams / 3 games / 10 players). Called by vitest
`globalSetup`; the live DB is never touched by `pnpm test`.
Run: `pnpm --filter @pll/ingest test:db:seed`.

### `generateUploadTemplate.ts`
Creates the coach-upload spreadsheet template workbook used by the web client.
Writes `packages/web/public/data/upload-template.xlsx` with a `Stats` sheet,
required headers, and example rows. Run:
`pnpm --filter @pll/ingest exec tsx src/scripts/generateUploadTemplate.ts`.

### `seedLaxnumbersAliases.ts` (Wave H2 — pending)
Will read the user-approved LaxNumbers → existing-team alias mapping and insert
into `team_aliases`. Blocked on manual decision item #2 in the hygiene plan.

## Maintenance

### `pruneBackups.ts` (Wave H0)
Rotate stale `data/lacrosse.db.bak*` files; keeps the most recent N. Run:
`pnpm --filter @pll/ingest run prune-backups -- --apply --keep 3`.

### `dedupTeams.ts`
Two-pass team-row dedup wrapped in a single transaction. Pass 0: hardcoded
hyphen-vs-space pairs (e.g. `Spring-Ford` vs `Spring Ford`). Pass 1: parenthetical
suffix dedup (preserves `(NJ)` / `(NY)` state markers). Backs up the DB to
`data/lacrosse.db.bak-w8-pre-dedup` before mutating.
Run: `pnpm --filter @pll/ingest dedup:teams`.

### `dedupPlayers.ts`
Merge duplicate player rows on the same `team_id` that collapse to the same
`normalizePlayerName` key (initial-with-period vs without, trailing period,
embedded position annotation, last-name-only vs full name when unambiguous).
Run: `pnpm --filter @pll/ingest dedup:players [-- --apply]`.

### `dedupStateSuffixTeams.ts`
After W14 added state-suffix stripping, finds `(suffixed, bare)` team pairs
that now collide on normalized name and merges into the bare row. Preserves
the suffixed display name as a `team_aliases` row. Audit: `data/state-suffix-dedup-w15.json`.
Run: `pnpm --filter @pll/ingest exec tsx src/scripts/dedupStateSuffixTeams.ts [--apply]`.

### `cleanGhostTeams.ts`
Sweep "ghost" team rows the score-line probe created from sub-header
abbreviations (`PR`, `DV`, `OH`). Best-effort orphan recovery: repoints
players whose ghost name plausibly matches initials of a real team before
deleting. Audit: `data/cleanup-log-w14.json`.
Run: `pnpm --filter @pll/ingest clean:ghosts [-- --apply]`.

### `cleanOrphanAliases.ts`
Delete `player_aliases` rows whose `player_id` no longer points at a live
`players` row (FK orphans from historic cleanup paths that bypassed FK
checks). Audit: `data/orphan-aliases-w15.json`.
Run: `pnpm --filter @pll/ingest exec tsx src/scripts/cleanOrphanAliases.ts [--apply]`.

### `cleanupJunkPlayers.ts`
Sweep degenerate player rows pre-dating stricter ingest guards: exact name
`None`, `No name provided`, names ending in `'s` or containing `'s ` mid-string.
Per-row FK check: rows with linked `player_stats` are PRESERVED + loudly
logged for manual review. Run: `pnpm --filter @pll/ingest cleanup:junk [-- --apply]`.

### `reattributeJunkStats.ts`
Handle the small set of stat rows still bound to junk player rows after
`cleanupJunkPlayers` ran. Per-row decisions baked in (rename in place,
reattribute to canonical id then delete, or soft-flag only).
Run: `pnpm --filter @pll/ingest reattribute:junk [-- --apply]`.

## Sync (external sources)

### `syncPiaa.ts`
One-shot: fetch PIAA D1 boys lacrosse rankings and replace
`piaa_official_teams` table contents (per-classification refresh).
Run: `pnpm --filter @pll/ingest exec tsx src/scripts/syncPiaa.ts`.

### `syncLogos.ts`
Sync team logos from the MaxPreps PA lacrosse schools index. Matches by
normalized `teams.name` / `teams.slug` (honors `data/team-overrides.json` for
manual fixups), downloads to `data/logos/<slug>.gif` (file-skip when
`Content-Length` matches), updates `teams.logo_url` + `teams.maxpreps_slug`.
250ms inter-download delay. Run: `pnpm --filter @pll/ingest run sync:logos`.

### `syncHudl.ts`
Authenticated Hudl scraper scaffold for a Harriton coach account. Logs into
Hudl with `HUDL_EMAIL` / `HUDL_PASSWORD`, optionally opens `HUDL_TEAM_URL`,
then heuristically scrapes roster rows plus per-game player stats using
Playwright. Supports `--headed` for first-run selector discovery and
`--dry-run` to log scraped output without mutating SQLite. Run:
`pnpm --filter @pll/ingest run sync:hudl -- --headed` or
`pnpm --filter @pll/ingest exec tsx src/scripts/syncHudl.ts --dry-run`.
