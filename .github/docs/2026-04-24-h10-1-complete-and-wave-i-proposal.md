# H10-1 Complete + Wave I Proposal

## H10-1 Result Summary

**Shipped:** `020b56a` feat(ingest): MaxPreps schedule URL discovery — pushed origin + legacy.

**Numbers (live run against 29-game team-score reconcile queue):**

| Metric | Before H10-1 | After H10-1 |
|---|---|---|
| MP scores fetched | 0/29 | **23/29** |
| Auto-applied corrections | 0 | **6** |
| Tests | 433 | **448** (+15 schedule tests) |

**6 score corrections applied** (PhillyLacrosse undercounted vs MaxPreps):
- Game 160 Ridley 18→19, Game 166 Avon Grove 13→15, Game 190 Ridley 19→20,
  Game 297 Crestwood 13→14, Game 471 Council Rock North 11→12, Game 789 Devon Prep 5→6

**Backup:** `data/lacrosse.db.bak-pre-h10-1`

## Wave I Candidate Queues (awaiting user direction)

### Queue A: 17 player-overcounts (`reject:mp_below_player_sum`)
Games where PhillyLacrosse player goal sums exceed MaxPreps team total. Indicates the
PL summary parser is counting too many goals for some players. Requires audit of the
specific games + likely a parser fix.
**Size:** L (multi-file investigation + fix)
**Risk:** Medium (touches summary parser hot path)

### Queue B: 2 missing maxpreps_slug entries
- Halftime – EA (likely a placeholder team that shouldn't be in the queue)
- Perkiomen (real team, just unmapped)
**Size:** S (data backfill)
**Risk:** Low

### Queue C: 4 schedule-lookup misses (fetch_failed despite team in DB)
WC Rustin g446, New Hope-Solebury g196, Hatboro-Horsham g207, Upper Dublin g396 + g7659.
Likely date-fuzz needed (±1 day) or opponent slug edge case.
**Size:** S (add fuzz match + retest against same queue)
**Risk:** Low

### Queue D: LaxNumbers aliases CSV (102 fuzzy team-name matches)
User-facing manual review queue (carried over from earlier waves).
**Size:** XL — must split before assigning. Already gated on user review.
**Risk:** Low (just unblocks LaxNumbers ingest)

### Recommendation
Wave I = **B + C in parallel** (both small, both unlock more reconcile auto-applies).
Then Wave J = Queue A (the bigger fish).

