# Remaining Ingest Anomalies — Post Wave 17

_Author: Chewy 🐻💪 (Wave 17 Lane 1, 2026-04-22)_

After the W17 final cleanup pass (13 explicit team-row merges + 9 schedule
alias additions + hs-summaries reparse), the `ingest_anomalies` table holds
**454 rows** down from a W16-era peak of ~3,140 (-86%). The remaining
buckets are dominated by **upstream-data quality issues** and **player-name
narration leakage**, neither of which is safely fixable from the ingest
side without changing parser semantics. This document is a maintainer-
oriented summary so future waves can decide whether to invest in each
cluster vs. accept the floor.

```
strategy_attempted        count   notes
─────────────────────────────────────────────────────────────────────────
quarter-line                223   PRIMARY: source-data sum errors (not us)
player-stat-line            212   PRIMARY: live-blog narration + ambiguous
aggregated-list               7   parser nit: "<Team> Saves:" header form
schedule-team-resolve         6   out-of-coverage NJ/DE schools (no team)
score-line                    6   parser nit: "Half X N, Y N" + 2OT suffix
─────────────────────────────────────────────────────────────────────────
                            454
```

## quarter-line (223) — source-data sum mismatches

Each anomaly here represents a per-team quarter-by-quarter line where the
sum of period scores does not equal the recorded final. Examples:

```
O'Hara: 10,6,2 != 1
AIM Academy: 0,1,1 != 5
Central Bucks West: 4,1,3 != 4
```

These are **typos in the source PhillyLacrosse posts** — the live blog
stat keepers fat-fingered the final period. The parser still stores the
period rows (the message reads "periods stored anyway"), so no game data
is lost; only the audit log notes the mismatch. **No fix possible from our
side.** Future maintainers could add a per-post override file if the
volume becomes a problem, but at <0.5 anomalies per game this is
acceptable noise.

## player-stat-line (212) — narration & ambiguous sub-headers

Three sub-clusters by raw_line shape:

1. **Player-name narration leakage** (~30 rows). Live-blog summaries
   include free-text play-by-play lines like
   `"Kevin Schlude captured his 100th career goal"` or
   `"Logan Bruette GWG"` that match the player-stat shape closely enough
   to enter the parser. These are not stat lines — they are author
   commentary — and the right outcome is to log + drop them, which is
   exactly what happens. **Not a bug; not fixable without a real-NLP
   pass.**

2. **Unresolved sub-headers** (~150 rows of the form
   `player stat dropped — uncertain team: <player> <stats> [unresolved
   sub-header: "<token>"]`). Top tokens by frequency:

   ```
   Malvern Prep      18    valid team — but the parent game's two teams
                            don't include Malvern Prep (player block
                            attached to a non-Malvern game)
   Springfield       14    ambiguous (Delco vs Township) and the parent
                            game's home/away is neither
   Dt East           12    Downingtown East — same shape; not in
                            parent game
   Springfield-D     11    Springfield-Delco — not in parent game
   PR                11    short-token reject (Pennridge); insert gate
                            in resolveScoreLineTeam intentionally rejects
                            bare 2-char ALL-CAPS to prevent ghost rows
   John Donovan      11    PLAYER NAME, not a team
   West Chester East 10    valid team; not in parent game
   Ridley Scoring:    9    sub-header parse — "Ridley" + "Scoring:"
                            suffix; the suffix-strip already covers this
                            elsewhere, look like a corner case
   ...
   ```

   The pattern is: a summary post lists multiple games, and the player
   block falls under a sub-header for a team that is not one of the two
   teams of the *currently-active* game. The parser correctly refuses to
   attribute the stats to a guess. **Fixing this requires the parser to
   re-anchor on sub-header instead of game order — a larger architectural
   change than W17 scope.**

3. **GWG / "winning goalie" narration suffixes** (~30 rows). Sub-header
   tokens like `"Logan Bruette GWG"` or `"Trey Prozzillo winning goalie"`
   come from the post author appending awards to a name. Same root cause
   as cluster 1.

## aggregated-list (7) — Saves-header parser corner case

All 7 rows are variations of `"CBW SAVES:"` or `"Goalie saves:"` —
case-only and goalie-prefix variants of the saves header form. The
section-strip in `normalizeTeamToken` already handles `"X Saves:"` for
the team-resolution path, but the aggregated-list parser has a stricter
literal match. **Low impact; cosmetic. Skip.**

## schedule-team-resolve (6) — out-of-coverage opponents

The 9 of 15 W16-Lane-2 unresolved schedule entries that DO map to a team
were aliased in W17 (see `seedTeamAliases.ts` PARSER_ABBREVIATIONS W17
block). The remaining 6 are NJ/DE/upstate-PA schools we do not track:

```
Caravel Academy (DE)               — DE private; no team row
Conestoga Valley High School       — PA Lancaster region; outside coverage
Julia R. Masterman High School     — PA Phila public; never tracked here
Kingsway Regional HS (NJ)          — NJ public
Oakcrest HS (NJ)                   — NJ public
St. Mark's HS (DE)                 — DE catholic
```

Their `schedule_games` rows persist with `team_id IS NULL` on one side,
which is the intended outcome for cross-border opponents. **No alias,
no team row needed — keep as anomalies for visibility.**

## score-line (6) — minor parser nits

Two patterns:

1. **`Half X N, Y N` halftime score lines** (2 rows): the parser expects
   `Team A N, Team B N` for final-score lines and skips halftime
   updates. Correct behaviour; the anomaly is just an audit note.
2. **Trailing `, 2OT` / `, 3OT` overtime suffixes** (4 rows): lines like
   `"Garnet Valley 10, Conestoga 9, 2OT"` fail the strict score regex
   because of the trailing OT marker. **Could be fixed with a regex
   tweak** but punted to the next parser-touch wave to avoid scope
   creep in W17.

## Recommended next steps (post-W17)

In rough cost/value order:

1. **score-line OT suffix** — 1-line regex fix in
   `packages/ingest/src/parsers/<scoreline>.ts`; recovers 4 anomalies and
   could surface 2-4 OT games we're currently missing. ★ High value,
   low cost.
2. **aggregated-list "Saves:" case insensitivity** — match the
   sub-header strip's case handling. Recovers 7 anomalies. ★ Medium.
3. **player-stat sub-header re-anchoring** — refactor the summary parser
   to break a post into per-sub-header blocks, then resolve each block's
   sub-header against ALL games in the post (not just the current one).
   Could clear ~150 anomalies AND recover the dropped player stats.
   ★★★ Highest data value but significant rewrite.
4. **quarter-line typo overrides** — manual per-post override JSON;
   probably not worth the maintenance burden for ~0.4 anomalies/game.
