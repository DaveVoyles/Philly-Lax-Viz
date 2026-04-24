# Source priority & score reconciliation

When data sources disagree, this project follows a fixed trust hierarchy.
Higher-authority sources always win; lower sources are fallbacks only.

## 1. Trust hierarchy

| Data | Authoritative source | Fallback | Last resort |
|---|---|---|---|
| Per-game score | **MaxPreps** | PhillyLacrosse | (none) |
| Season W/L | **PIAA** | computed from games | PhillyLacrosse |
| Per-player stats | **PhillyLacrosse** | (none) | (none) |

## 2. Why PIAA is empty for per-game scores

The PIAA District 1 page publishes only season standings — wins, losses, and
total points scored across the season — not individual game results. So while
PIAA wins overall on team-record disputes (it is the official sanctioning
body), it cannot help reconcile a single suspect game score. That is where
MaxPreps comes in: MaxPreps publishes per-game box scores, which is the level
of granularity the H9 reconciliation queue operates on.

## 3. When to invoke each source

- **PIAA** — runs nightly via `syncPiaa` (already automated). To check season
  totals drift on demand:
  ```bash
  pnpm --filter @pll/ingest exec tsx src/scripts/piaaCheckTotals.ts
  ```
  Output lands in `.github/docs/2026-04-24-piaa-totals-mismatch.json`.

- **MaxPreps** — invoke on demand when the per-game reconcile queue grows
  (player-goals sum > recorded team score):
  ```bash
  pnpm --filter @pll/ingest reconcile:scores            # dry-run
  pnpm --filter @pll/ingest reconcile:scores --apply    # writes
  ```
  Auto-apply only fires when MaxPreps confirms a value with high confidence
  (parsed integer score ≥ player-goals sum, ≤ player-goals sum + 5). Every
  attempt — applied or not — is recorded in `score_sources` for auditability.

- **PhillyLacrosse** — continuous, every ingest tick. This is the default
  primary source for player stats and the fallback for game scores when
  MaxPreps has no entry.

## 4. Manual override

If MaxPreps is wrong (or the page is unreachable) and you need to apply a
known-good score by hand, write directly to `score_sources` and `games` in
one transaction so the audit trail stays intact:

```sql
BEGIN;
INSERT INTO score_sources (game_id, team_side, source, score, fetched_at, applied, prior_score)
VALUES (1234, 'home', 'manual', 12, datetime('now'), 1,
        (SELECT home_score FROM games WHERE id = 1234));
UPDATE games SET home_score = 12 WHERE id = 1234;
COMMIT;
```

Use `source = 'manual'` (not `'maxpreps'`) so the override is distinguishable
in audit reviews. Always set `prior_score` from the live row before the update.

## 5. Reverting a bad apply

Every `score_sources` row with `applied = 1` carries the `prior_score` it
overwrote. To roll back:

```sql
-- 1. Find the bad apply (most recent for the affected game/side):
SELECT id, source, score, prior_score, fetched_at
FROM score_sources
WHERE game_id = 1234 AND team_side = 'home' AND applied = 1
ORDER BY fetched_at DESC
LIMIT 1;

-- 2. Restore the prior score and mark the apply reverted:
BEGIN;
UPDATE games
   SET home_score = (SELECT prior_score FROM score_sources WHERE id = 5678)
 WHERE id = 1234;
UPDATE score_sources SET applied = 0 WHERE id = 5678;
COMMIT;
```

After reverting, the row remains in `score_sources` for history; the game is
back to its pre-reconcile value and re-eligible for the next reconcile run.
