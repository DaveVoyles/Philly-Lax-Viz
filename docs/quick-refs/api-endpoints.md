# API Endpoints Quick Reference

> **Token cost:** ~750 tokens  
> **When to load:** Need to call API endpoints, understand API structure  
> **See also:** [architecture-full.md](../architecture-full.md) for query implementation details

---

## API Base URLs

| Environment | URL |
|-------------|-----|
| **Production** | `https://phillylaxstats.com` |
| **Local dev** | `http://localhost:3001` |

---

## Core Endpoints (Public Read-Only)

### Teams

| Method | Path | Returns | Cached? |
|--------|------|---------|---------|
| GET | `/api/teams` | List all teams | ✅ 60s |
| GET | `/api/teams/:id` | Team detail + games + record | ✅ 60s |
| GET | `/api/teams/:id/topScorers` | Top 10 scorers for team | ✅ 60s |

**Example:**
```bash
curl https://phillylaxstats.com/api/teams/42
```

### Games

| Method | Path | Returns | Cached? |
|--------|------|---------|---------|
| GET | `/api/games` | List all games (supports `?season=2026`) | ✅ 60s |
| GET | `/api/games/:id` | Full game detail + periods + player stats | ✅ 60s |
| GET | `/api/games/calendar` | Calendar view (date + count) | ✅ 60s |

**Example:**
```bash
curl https://phillylaxstats.com/api/games/123
```

### Players

| Method | Path | Returns | Cached? |
|--------|------|---------|---------|
| GET | `/api/players` | List all players (supports `?season=2026`) | ✅ 60s |
| GET | `/api/players/:id` | Player detail + season totals + per-game stats | ✅ 60s |
| GET | `/api/players/constellation` | Bubble chart data (goals vs. assists) | ✅ 60s |

**Example:**
```bash
curl https://phillylaxstats.com/api/players/456
```

### Leaders

| Method | Path | Returns | Cached? |
|--------|------|---------|---------|
| GET | `/api/leaders/players` | Player leaderboards (query: `?metric=goals`) | ✅ 60s |
| GET | `/api/leaders/teams` | Team leaderboards (query: `?metric=wins`) | ✅ 60s |
| GET | `/api/leaders/players/sparklines` | Trend sparklines for top players | ✅ 60s |

**Supported metrics:**
- Players: `goals`, `assists`, `points`, `ground_balls`, `caused_turnovers`, `saves`, `faceoff_percentage`
- Teams: `wins`, `losses`, `points_for`, `points_against`, `goal_differential`

**Example:**
```bash
curl "https://phillylaxstats.com/api/leaders/players?metric=goals&season=2026&limit=50"
```

### Rankings

| Method | Path | Returns | Cached? |
|--------|------|---------|---------|
| GET | `/api/rankings` | PIAA District 1 official standings | ✅ 60s |
| GET | `/api/laxnumbers-ratings` | LaxNumbers power ratings | ✅ 60s |

### Schedule

| Method | Path | Returns | Cached? |
|--------|------|---------|---------|
| GET | `/api/schedule` | Upcoming games | ✅ 60s |
| GET | `/api/schedule/team/:id/upcoming` | Upcoming games for specific team | ✅ 60s |

### College Commitments

| Method | Path | Returns | Cached? |
|--------|------|---------|---------|
| GET | `/api/commitments` | All commitments (supports `?verified=true`) | ✅ 60s |
| POST | `/api/commitments/submit` | Submit new commitment | ❌ |

**POST body:**
```json
{
  "player_name": "John Doe",
  "college": "University of Pennsylvania",
  "division": "D1",
  "commit_date": "2026-05-15",
  "submitter_name": "Coach Smith",
  "submitter_email": "smith@example.com"
}
```

---

## Comparison & Analysis (No Cache)

### Head-to-Head

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/h2h/teams?teamId1=42&teamId2=43` | Team H2H history |
| GET | `/api/h2h/players?playerId1=456&playerId2=457` | Player comparison |

### Rivalries

| Method | Path | Returns | Cached? |
|--------|------|---------|---------|
| GET | `/api/rivalries` | Top rivalries (most-played matchups) | ✅ 60s |

### Player Comparison

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/compare/players?ids=456,457,458` | Multi-player comparison |

---

## Coach Tools (Admin/Coach-Only)

### Coach Dashboard

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/coach/dashboard?teamId=42&season=2026` | Full dashboard analytics |
| GET | `/api/coach/trends?teamId=42&season=2026` | Performance trends |
| GET | `/api/coach/scouting?teamId=42&season=2026` | Opponent scouting report |
| GET | `/api/coach/practice-focus?teamId=42&season=2026` | Practice focus areas |

**Authentication:** Not enforced (honor system for demo).

### Coach Upload

| Method | Path | Returns |
|--------|------|---------|
| POST | `/api/upload` | Upload coach spreadsheet (.xlsx) |

**Multipart form data:**
```
file: <binary .xlsx file>
teamId: 42
submitter: "Coach Smith"
email: "smith@example.com"
```

---

## Admin-Only Endpoints

### Community Corrections

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/corrections/flagged` | Outlier corrections awaiting review |
| GET | `/api/corrections/recent` | Recently applied corrections |
| POST | `/api/corrections` | Submit correction from web UI |

**POST body:**
```json
{
  "submitter_name": "John Doe",
  "submitter_email": "john@example.com",
  "entity_type": "player_stat",
  "entity_id": 789,
  "field_name": "goals",
  "old_value": "2",
  "new_value": "5"
}
```

### Deduplication

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/admin/dedup-candidates` | Potential duplicate entities |
| PATCH | `/api/admin/dedup-candidates/:id` | Update dedup status |
| POST | `/api/admin/dedup-candidates/:id/merge` | Merge duplicates |

### Hudl Management

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/hudl/teams` | Registered Hudl teams |
| POST | `/api/hudl/teams` | Register new Hudl team |
| PATCH | `/api/hudl/teams/:id` | Update Hudl team status |

---

## Utility Endpoints

### Health Check

| Method | Path | Returns | Cached? |
|--------|------|---------|---------|
| GET | `/api/health` | API health status + DB version | ❌ |

**Response:**
```json
{
  "status": "ok",
  "db_version": 23,
  "timestamp": "2026-06-23T12:00:00Z"
}
```

### Data Freshness

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/freshness` | Last ingest timestamp per source |

**Response:**
```json
{
  "phillylacrosse": "2026-06-23T06:00:00Z",
  "piaa": "2026-06-22T18:00:00Z",
  "maxpreps_logos": "2026-06-20T12:00:00Z"
}
```

### Search

| Method | Path | Returns | Cached? |
|--------|------|---------|---------|
| GET | `/api/search?q=harriton` | Search teams and players | ✅ 60s |

### Seasons

| Method | Path | Returns | Cached? |
|--------|------|---------|---------|
| GET | `/api/seasons` | Available seasons | ✅ 60s |

### Anomalies

| Method | Path | Returns | Cached? |
|--------|------|---------|---------|
| GET | `/api/anomalies` | Unresolved ingest anomalies | ✅ 60s |
| GET | `/api/anomalies/summary` | Anomaly counts by source | ✅ 60s |

### Post Images

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/posts/images?gameId=123` | Images from recap posts |

---

## PBLA (Philadelphia Box Lacrosse)

| Method | Path | Returns | Cached? |
|--------|------|---------|---------|
| GET | `/api/pbla/standings?season=2026` | PBLA league standings | ✅ 60s |
| GET | `/api/pbla/players?season=2026` | PBLA scoring leaders | ✅ 60s |
| GET | `/api/pbla/goalies?season=2026` | PBLA goalie leaders | ✅ 60s |
| GET | `/api/pbla/schedule?season=2026` | PBLA schedule/results | ✅ 60s |

---

## Response Caching

Selected read-only `GET` endpoints use in-memory LRU cache (60s TTL) via `packages/server/src/plugins/responseCache.ts`.

**Cache headers:**
```http
ETag: "hash-of-response"
Cache-Control: public, max-age=60
X-Cache: HIT | MISS
```

**Cache bypass:** Requests with `Authorization` header skip cache.

---

## Error Responses

| Status | Meaning | Example |
|--------|---------|---------|
| 400 | Bad Request | Missing required query param |
| 404 | Not Found | Team/player/game ID doesn't exist |
| 500 | Server Error | DB query failed |

**Error format:**
```json
{
  "error": "Team not found",
  "statusCode": 404
}
```

---

## Static Logo Assets

Team logos are served statically (not via API routes):

```
https://phillylaxstats.com/logos/harriton.gif
```

- **Path:** `/logos/{filename}`
- **Source:** `data/logos/` directory
- **Cache:** 1 year immutable

**Important:** The DB stores only the bare filename (e.g., `harriton.gif`). The client/server must prefix `/logos/` when building URLs.

---

## Rate Limits

**Production:** No enforced rate limits (honor system).  
**Future:** May add `express-rate-limit` if abuse occurs.

---

## Common Query Patterns

### Get team's full season stats
```bash
curl "https://phillylaxstats.com/api/teams/42?season=2026"
```

### Get recent games
```bash
curl "https://phillylaxstats.com/api/games?season=2026&limit=20"
```

### Get top goal scorers
```bash
curl "https://phillylaxstats.com/api/leaders/players?metric=goals&season=2026&limit=50"
```

### Search for player
```bash
curl "https://phillylaxstats.com/api/search?q=john+doe"
```

---

**For query implementation details, see:** Route files in `packages/server/src/routes/` and query modules in `packages/server/src/queries/`
