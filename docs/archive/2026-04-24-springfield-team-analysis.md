# Springfield-Delco vs Springfield Township — Merge Analysis

**Status:** ⚠️ **Do not merge** — evidence shows two different schools.
**Generated:** 2026-04-24 (in response to user "they are the same team")

## TL;DR

There are **two real high schools** named "Springfield" in greater Philadelphia, in different counties, in different conferences, with different mascots, playing entirely different opponent sets. The data in our DB correctly reflects this. **Merging them would corrupt season records.**

The actual bug is a **MaxPreps slug collision** — both rows point to the same MP URL. That's the fix to make, not a merge.

## Evidence

### Real-world identity

| | **Springfield-Delco** (id 37) | **Springfield Township** (id 174) |
|---|---|---|
| County | Delaware County (PA) | Montgomery County (PA) |
| District | School District of Springfield Township (Delco) — Springfield, PA 19064 | Springfield Township SD (Montco) — Erdenheim, PA 19038 |
| PIAA Class | D1 3A | D1 2A |
| Mascot | **Cougars** | **Spartans** |
| Conference | Central League (Delco) | Suburban One — Liberty/Freedom |
| Our DB color set | `#000000` / `#B22234` | (none) |
| MaxPreps slug | `springfield/springfield-cougars` ✅ | `springfield/springfield-cougars` ❌ wrong (collision) |

### Game schedules (zero opponent overlap)

**Springfield-Delco (10 games, 8-2)** — all Delco/Central League + Inter-Ac/private opponents:
- Cardinal O'Hara, Broadneck (MD), Upper Darby, Ridgewood NJ, Radnor, Lower Merion, Haverford High, Harriton, St. Joseph's Prep, Strath Haven

**Springfield Township (6 games, 0-6)** — all Montco/Suburban One opponents:
- Plymouth Whitemarsh, Archbishop Ryan, Upper Moreland, Upper Dublin, New Hope-Solebury, Abington

**Zero shared opponents.** A school can't be in two conferences with two different schedules in the same season — these are 16 distinct game records belonging to 16 distinct events at 16 distinct schools.

### Aliases attached

| team_id | alias | source |
|---:|---|---|
| 37 | `springfield` | piaa-bootstrap |
| 37 | `springfield (delco)` | parser-abbrev-w10 |
| 37 | `springfield-d` | parser-abbrev-w10 |
| 174 | `springfield twp` | piaa-bootstrap |
| 174 | `springfield twp.(m)` ← *(m) = Montco* | parser-abbrev-w10 |

PIAA bootstrap (verified manually 2026-04-22) explicitly seeded **two** Springfields, one to each row. PIAA's official D1 roster has them as separate teams (3A vs 2A).

## What's actually broken

**The MaxPreps slug collision.** Both rows have `maxpreps_slug = 'springfield/springfield-cougars'`. That URL is real — it's Springfield-Delco's MaxPreps page. Springfield Township (Montco) is a different MaxPreps page (likely `erdenheim/springfield-township-spartans` or similar — the school's actual mascot is the Spartans).

When the H10-1 schedule discovery runs for a Springfield Township game, it currently:
1. Looks up team 174's slug → `springfield/springfield-cougars`
2. Fetches Springfield-Delco's schedule
3. Tries to find the Springfield Township game in it → **misses** (because that game isn't on Springfield-Delco's schedule)

This explains some of the schedule-discovery misses we've been seeing.

## Recommended fix

Two small SQL updates, no merges, no deletes:

```sql
-- Option A: clear the wrong slug; let schedule discovery skip until the
-- correct slug is researched.
UPDATE teams SET maxpreps_slug = NULL WHERE id = 174;

-- Option B (better, if user can verify): set Springfield Township's true
-- MaxPreps slug. Likely one of:
--   erdenheim/springfield-township-spartans
--   philadelphia/springfield-township-spartans
--   flourtown/springfield-township-spartans
-- The user can paste the right URL after viewing maxpreps.com search.
UPDATE teams SET maxpreps_slug = 'erdenheim/springfield-township-spartans' WHERE id = 174;
```

## What to verify before any merge

If you still believe they're the same team, please confirm by looking at one of these:

1. **The schools' websites** — is there one Springfield HS or two?
   - Springfield-Delco: https://www.ssdcougars.org/
   - Springfield Township (Montco): https://www.sdst.org/Domain/13
2. **The opponent rosters** — Springfield-Delco played Cardinal O'Hara, Radnor, Strath Haven (all Delco). Springfield Township (174) played Upper Dublin, New Hope-Solebury, Abington (all Montco). Could one school play 16 games in two completely separate league schedules?
3. **The PIAA listing** — D1 has both 3A "Springfield" (id corresponds to Delco) and 2A "Springfield Twp" (id corresponds to Montco) as separate teams.

## Recommendation

**Do not merge.** Fix the MP slug collision instead. If you have any doubt, open the two school websites above — they're physically 25 miles apart in different counties.

If you confirm "no, I really do mean merge them," I can do that — but it's a destructive action that conflates 8-2 Cougars with 0-6 Spartans into a single 8-8 record.
