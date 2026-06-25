# Runbook: PBLA Season Transition

> Use this when the PBLA season ends (late August) or a new season begins (May).  
> Each year the league gets a new Sportability league ID — every hardcoded reference must be updated.

---

## Step 1 — Find the new league ID

1. Open `https://secure.sportability.com/spx/Leagues/Standings.asp` in a browser
2. The PBLA league will appear in the dropdown once it's created (typically April–May)
3. Select it and copy the `LgID` value from the URL  
   Example: `...Standings.asp?LgID=50731` → league ID is `50731`

---

## Step 2 — Update all league ID references

Update `LEAGUE_IDS` / `ids` maps in these four files (search for the previous year's ID to find all locations):

```bash
grep -r "50731\|50247" packages/ --include="*.ts" -l
```

| File | What to update |
|------|---------------|
| `packages/ingest/src/scripts/syncPbla.ts` | `LEAGUE_IDS` map |
| `packages/server/src/routes/pbla.ts` | `ids` map in `getCurrentLeagueId()` |
| `packages/server/src/scheduler/pblaScheduler.ts` | `LEAGUE_IDS` map |
| `packages/web/src/views/pblaLoader.ts` | `PBLA_DEFAULT_SEASON` constant |

---

## Step 3 — Add a new SEASONS entry to pblaData.ts

Add a new entry to the `SEASONS` array with empty data. CI will fill it in:

```typescript
{
  year: 2027,
  leagueId: <new_id>,
  label: '2027 (Current)',
  teams: [],
  players: [],
  goalies: [],
  rosters: {},
  games: [],
},
```

Also update `PBLA_DEFAULT_SEASON = 2027` at the top of the file.

---

## Step 4 — Update syncPblaVideos.ts year

```typescript
const TARGET_YEAR = '2027';
```

And clear the old `PBLA_VIDEOS` entries — they'll be repopulated automatically by the first `sync-pbla.yml` run after streams begin.

---

## Step 5 — Update TEAM_META in pblaLoader.ts

If any teams are new, renamed, or have new captains/jersey images, update the `TEAM_META` map in `packages/web/src/views/pblaLoader.ts`.

---

## Step 6 — Trigger a manual sync

```bash
gh workflow run sync-pbla.yml
```

This will:
1. Scrape the new season's standings, games, and player stats from Sportability
2. Write them to the DB, upload to Azure, restart the container
3. Patch `pblaData.ts` with real team/game data
4. Commit and deploy

---

## Step 7 — Verify

```bash
# Live API should return new season data
curl https://phillylaxstats.com/api/pbla/standings?league_id=<new_id>

# Scrape log should show today's date
curl https://phillylaxstats.com/api/pbla/scrape-log | python3 -m json.tool

# Run a dry-run check locally
pnpm pbla:check -- --generate
```

---

## Common pitfalls

| Pitfall | Fix |
|---------|-----|
| `sync-pbla.yml` scrapes wrong season | Check that all four `LEAGUE_IDS` maps were updated |
| Team names changed between seasons | Update `TEAM_META` in `pblaLoader.ts` and the hardcoded `SEASONS` entry |
| Video links show for old season | Clear `PBLA_VIDEOS` entries — `syncPblaVideos.ts` won't overwrite existing entries |
| `gp=0` for all teams on day 1 | Normal — Sportability doesn't show stats until after game 1 is entered |
