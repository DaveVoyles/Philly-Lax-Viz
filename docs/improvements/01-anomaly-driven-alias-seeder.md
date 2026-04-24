# 01 — Anomaly-Driven Team Alias Auto-Seeder

> **Lane:** Han 😉🚀 (Data quality)
> **Category:** Ingest correctness · alias system · source-priority

## Motivation

The single largest class of ingest defects in `data/lacrosse.db` is **unresolved
sub-headers in summary posts** — short tokens like `"Bucs"`, `"Big Red"`,
`"Section"`, `"Knights"` that PhillyLacrosse.com writers use as bylines above a
roster's stat line. The parser cannot map them to either side of the score
line, so the entire stat block is dropped to `ingest_anomalies`.

Concrete numbers from the current snapshot (605 games, 6,790 player_stats):

| Reason                                                              | Count | % of all anomalies |
| ------------------------------------------------------------------- | ----: | -----------------: |
| `sub-header did not match either game team …`                       |   151 |              ~24 % |
| `team hint did not resolve to either side of the score line`        |    59 |               ~9 % |
| `period sum does not equal total — periods stored anyway`           |    70 |              ~11 % |
| `no stat tokens recognized in line`                                 |    39 |               ~6 % |
| **Combined alias-shaped failures (rows 1 + 2)**                     | **210** |        **~33 %** |

Every dropped sub-header line costs us a player-stat row — the
`Bucs` example alone shows five Father Judge scorers vanishing from a single
game, and `"Logan Bruette GWG"` (a player-name byline misread as a team) drops
seven Garnet Valley scorers. We currently have **9 manually-curated aliases**
in `team_aliases` (plus 110 piaa-bootstrap rows), which is clearly under-resourced
for a 207-team corpus.

This proposal is the highest-ROI ingest-quality work on the board: a single
batched seeding pass should zero out roughly **a third of all live anomalies**
and recover an estimated **800–1,200 player-stat rows** that are currently
sitting in `ingest_anomalies.raw_line`.

## Current state

- **Alias storage:** `team_aliases (alias TEXT UNIQUE, team_id, source, confidence)`.
  Today it holds 119 rows: 110 from the `piaa-bootstrap` seed and 9 manual
  fixes (`cb south → 56`, `hatborohorsham → 100`, etc.).
- **Resolution path:** `packages/ingest/src/pipelines/teamResolver.ts`
  normalizes via `normalizeTeamName()` (lowercase, strip HS/H.S./parenthetical
  state suffix, fold curly quotes/dashes), then attempts:
  1. exact match on `teams.name_normalized`,
  2. `team_aliases.alias` lookup,
  3. initials fallback (`"WK"` → `"Worthington Kilbourne"`),
  4. parent-game side hinting in summaries.
- **Sub-header probe:** `packages/ingest/src/pipelines/summaries.ts` (called from
  the per-post pipeline) records the failure to `ingest_anomalies` with
  `strategy_attempted = 'subheader-resolve'` and `raw_line` containing the
  unresolved token in brackets — see the 12 sample rows already on disk
  (e.g. `[unresolved sub-header: "Bucs"]`).
- **What we *don't* have:** any feedback loop from `ingest_anomalies` back into
  `team_aliases`. The 151 failing tokens are observable in SQL today but never
  promoted to aliases. Recent fixes (Marple Newtown / Harriton split, Springfield
  slug, Township reconcile — see `data/lacrosse.db.bak-pre-*` filenames) were
  all applied by hand to `teams` or `team_aliases` after the fact.

## Proposed design

### Phase A — Anomaly miner (read-only)

A new script `packages/ingest/src/scripts/mine-team-aliases.ts` that:

1. Scans `ingest_anomalies` for `strategy_attempted IN ('subheader-resolve',
   'team-hint-resolve')`.
2. Extracts the **unresolved token** from `raw_line` using a single regex
   anchored on the existing `[unresolved sub-header: "…"]` /
   `[unresolved team hint: "…"]` brackets.
3. Joins each anomaly to its `parent_game_id` → `games.home_team_id` /
   `away_team_id` to get the **two candidate team IDs** (the home and away of
   the post the anomaly came from).
4. Aggregates: `(normalized_token, candidate_team_id, count)` and emits a
   review TSV to `data/proposed-aliases.tsv`, sorted by count desc, with
   columns:

   ```
   token  candidate_home  candidate_away  occurrences  example_game_id  example_url
   ```

The miner does **not** write to `team_aliases`. Phase A is pure read; it
exists so a human (or Lane 5 when it lands) can spot-check the proposals.

### Phase B — Confidence-scored auto-seeder

A second script `packages/ingest/src/scripts/seed-team-aliases.ts` that
consumes the TSV (or, with `--from-db`, re-runs the miner inline) and writes
to `team_aliases` with rules:

| Signal                                                         | confidence | source                  |
| -------------------------------------------------------------- | ---------: | ----------------------- |
| Token appears in ≥ 3 distinct posts, **always** for same team  |       0.95 | `anomaly-mined`         |
| Token appears in ≥ 2 posts, same team, no contradictions       |       0.80 | `anomaly-mined`         |
| Token is a substring of `teams.name_normalized` (e.g. "Judge"  ⊂ "Father Judge") |       0.90 | `substring-derived`     |
| Token is unambiguous initials of one game-side team            |       0.85 | `initials-derived`      |
| Anything else (single occurrence, ambiguous)                    |          — | **rejected — TSV only** |

The seeder runs in a single transaction:

```ts
INSERT OR IGNORE INTO team_aliases (alias, team_id, source, confidence)
VALUES (?, ?, ?, ?);
```

`OR IGNORE` is safe because `alias` is UNIQUE — a manual entry always wins.
A `--dry-run` flag prints diff vs. emitting writes (default).

### Phase C — Schema & feedback

Two small migrations in `packages/server/src/migrations/` (or wherever the
existing migrations live — TBD; see Open Questions):

1. **Add `team_aliases.created_at TEXT`** (default `CURRENT_TIMESTAMP`) so we
   can audit which aliases came from which mining run.
2. **Add `team_aliases.notes TEXT NULL`** to record the example raw_line that
   justified an auto-seeded entry — invaluable when a future false-positive
   needs to be retired.

Then wire the seeder into the existing ingest entrypoint with an opt-in flag:

```bash
pnpm --filter @lax/ingest ingest -- --mine-aliases --confidence 0.85
```

Default ingest behavior is **unchanged** until the operator explicitly opts in.

### Phase D — Re-run anomalous posts

After seeding, a third script `packages/ingest/src/scripts/replay-anomalies.ts`:

1. `SELECT DISTINCT source_post_id FROM ingest_anomalies WHERE strategy_attempted IN (…)`.
2. For each post, re-runs `pipelines/summaries.ts` against the cached HTML.
3. Deletes the now-resolved anomalies.

This converts the alias seeding into recovered `player_stats` rows in the
same run.

## Scope

**In scope**

- Mining anomalies → review TSV (`mine-team-aliases.ts`).
- Confidence-scored auto-seeder with `OR IGNORE` semantics.
- Two additive `team_aliases` columns (`created_at`, `notes`).
- Replay script for previously-anomalous posts.
- Unit tests for the confidence rules.

**Out of scope**

- Player-name aliasing — see proposal 02.
- Cross-source reconciliation when two sources agree on different team names
  for the same game (handled by source-priority doc in `docs/runbooks/`).
- Editing `teams.name` for cosmetic display — orthogonal.
- Schema constraints beyond the two added columns.

## Validation plan

1. **Baseline snapshot:** `sqlite3 data/lacrosse.db.bak-pre-alias-seed
   "SELECT COUNT(*) FROM ingest_anomalies WHERE strategy_attempted IN
   ('subheader-resolve','team-hint-resolve');"` — record the pre-run count
   (expected ≈ 210).
2. **Dry-run output check:** the TSV should have ≤ 80 unique tokens (current
   151 sub-header anomalies are highly repetitive — `"Bucs"` alone accounts
   for ≥ 5 rows, `"Logan Bruette GWG"` for 7).
3. **Seeded confidence floor:** `SELECT COUNT(*) FROM team_aliases WHERE
   source = 'anomaly-mined' AND confidence < 0.80` must be 0.
4. **Recovery delta:** after replay, re-count anomalies; expect a drop of
   **≥ 60 %** of the targeted strategies and **≥ +800 player_stats** rows.
5. **Regression guard:** `pnpm --filter @lax/ingest test` — extend the parser
   suite under `packages/ingest/src/parsers/__tests__/` with the 12 sample
   sub-header lines already in the DB; assert they now resolve.
6. **Spot-check 5 PhillyLacrosse posts manually:** open the `source_url`
   from the replay log, confirm scorer counts match the published recap.

## Effort estimate

**M (3–5 focused days)**

- Day 1: miner + TSV emit + tests against a fixture DB copy.
- Day 2: seeder + confidence rules + dry-run mode + migration.
- Day 3: replay harness + integration test that round-trips one cached post.
- Day 4–5: review the TSV with a human (Dave), tune thresholds, run for real
  on `data/lacrosse.db`, write a runbook entry under `docs/runbooks/`.

The work is bounded because (a) all the data already exists, (b) the parser
already exposes the unresolved token in `raw_line`, and (c) the alias table
is the single intended write target — no new join tables.

## Risk

**Low–Medium**

| Risk                                                       | Likelihood | Impact | Mitigation                                                    |
| ---------------------------------------------------------- | :--------: | :----: | ------------------------------------------------------------- |
| Auto-seeded alias maps to the wrong team                   |   Medium   |  High  | Confidence floor 0.80; require ≥ 2 posts; `OR IGNORE` so manual entries override; `notes` column makes retirement trivial. |
| Token like `"Logan Bruette GWG"` is a player line, not a team | Medium  | Medium | Reject tokens with > 3 whitespace-separated words **or** any digit; reject tokens appearing in `players.name_normalized`. |
| Replay script re-runs the wrong cached HTML                |    Low     | Medium | Replay only when `source_url` matches `cached_html.url`; otherwise skip and log. |
| Migration breaks existing ingest                           |    Low     |  Low   | Both new columns are `NULL`-able with defaults; no existing query needs to change. |
| Mined alias collides with a real team's actual name        |    Low     | Medium | Pre-flight check: reject any token already present in `teams.name_normalized`. |

## Open questions

1. **Where do migrations live?** I see no `migrations/` dir in
   `packages/server/src/` from the snapshot — confirm the current pattern
   (raw `.sql` shipped with `better-sqlite3`? An in-code `applyMigrations()`?).
2. **Confidence threshold for auto-write** — propose 0.85 default; 0.80 for
   `--aggressive`. Acceptable?
3. **Should `anomaly-mined` aliases be treated as lower priority than
   `piaa-bootstrap` in the resolver?** Currently the resolver doesn't read
   `confidence`; if we want a tiebreaker, that's a follow-up.
4. **Player-name false positives** — the `"Logan Bruette GWG"` case suggests
   we should also reject tokens whose first two words match any
   `players.name_normalized`. Worth the extra check, or rely on the word-count
   filter alone?
