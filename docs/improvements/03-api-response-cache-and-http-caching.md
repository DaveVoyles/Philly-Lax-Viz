# 03 — In-memory API response cache + ETag / Cache-Control

## Motivation

The production database is **read-only between deploys** (snapshot-on-deploy
model in `infra/`), and the workload is read-heavy: every dashboard load fans
out into ~6 GETs (`/api/teams`, `/api/games/recent`, `/api/leaders/...`,
`/api/post-images`, `/api/health`). Yet none of the `/api` routes set
`Cache-Control` or emit `ETag` today:

```
$ grep -rn "Cache-Control\|etag\|ETag\|setHeader" packages/server/src
# (no results in routes; only @fastify/static logos path uses cacheControl)
```

That means:

- Every browser refresh re-fetches every endpoint over the wire.
- Every revisit of a tab re-runs the same SQL aggregations against
  `packages/server/src/queries/leaderboards.ts`, `h2h.ts`, `constellation.ts`.
- The single 0.5-CPU container has to recompute identical JSON on each request.

A representative leaderboard call already takes ~29 ms of pure SQLite time on
the dev box (timed below). Under cold start (scale-to-zero container app), the
first 6 dashboard requests serialise behind a process that is also doing module
load and DB open — the user's TTFB compounds.

We can collapse this from "every request hits SQLite" to "first request hits
SQLite, all following requests within TTL hit memory or 304 Not Modified".

This is the single highest user-visible perf win available without touching
schema or front-end code.

## Current state

**Server** (`packages/server/src/app.ts`):

- Fastify 5 with `@fastify/cors` and `@fastify/static`.
- `@fastify/static` for `/logos/` already sets `cacheControl: true,
  maxAge: 31536000000, immutable: true` ✅.
- All 18 `/api/*` route plugins (`routes/leaders.ts`, `routes/teams.ts`, …) call
  `reply.send(payload)` directly. No `Cache-Control`, no `ETag`, no `Last-
  Modified`, no in-memory memoisation.
- Container app: 0.5 CPU / 1 Gi memory, scale-to-zero, single replica
  (`infra/`). DB journal mode is `DELETE` in prod (read-only filesystem).

**DB shape** (`data/lacrosse.db`):

| Table          | Rows  |
|----------------|-------|
| games          | 605   |
| player_stats   | 6,790 |
| players        | 1,929 |
| teams          | 207   |

**Measured query cost** — leaderboard "points" query from
`packages/server/src/queries/leaderboards.ts:148-208`:

```
$ sqlite3 data/lacrosse.db < leaderboard.sql
Run Time: real 0.029 user 0.024138 sys 0.002665
```

`EXPLAIN QUERY PLAN` for the same query:

```
|--MATERIALIZE recent
|  |--CO-ROUTINE ranked
|  |  |--CO-ROUTINE per_game
|  |  |  |--SCAN ps USING INDEX sqlite_autoindex_player_stats_1
|  |  |  `--SEARCH g USING INTEGER PRIMARY KEY (rowid=?)
|  |  `--USE TEMP B-TREE FOR ORDER BY
|  `--USE TEMP B-TREE FOR GROUP BY
|--SCAN p USING INDEX idx_players_team_id
|--SEARCH ps USING INDEX idx_player_stats_player_id (player_id=?)
|--SEARCH r USING AUTOMATIC COVERING INDEX (player_id=?) LEFT-JOIN
|--USE TEMP B-TREE FOR GROUP BY
`--USE TEMP B-TREE FOR ORDER BY
```

Two **TEMP B-TREE for ORDER BY** + a **MATERIALIZE recent** CTE rebuilt on
*every* request. There is no metric-aware index that can satisfy the ORDER BY,
so SQLite always sorts in memory. Adding indices won't fix this — the metric
varies per request (`points`, `goals`, `assists`, `fo_pct`, …, 8 metrics × 4
filter shapes).

The only realistic "make it disappear" play is **don't run the query at all**
when the answer is unchanged.

## Proposed design

Two cooperating layers, both read-through, both invalidated by a single
"snapshot epoch" identifier:

### Layer 1 — Server-side LRU response cache

A small Fastify plugin (~80 LOC, depends only on `lru-cache`):

```
packages/server/src/plugins/responseCache.ts
```

- Wraps a configurable subset of `GET /api/*` routes via `onRequest` /
  `onSend` hooks.
- Cache key: `${routeId}::${sortedQueryString}`.
- Cache value: `{ etag, body, contentType, cachedAt }`.
- LRU bound by entry count (default 500 entries, ~ a few MB) and TTL
  (default 60 s — see Open questions on whether infinite-until-deploy is safer).
- On cache hit: `reply.header('x-cache','HIT').send(cachedBody)`.
- On cache miss: capture serialised JSON in `onSend`, store, set
  `x-cache: MISS`.

Routes worth caching (high cost, low cardinality):

| Route                          | Source file                                |
|--------------------------------|--------------------------------------------|
| `/api/leaders/players`         | `routes/leaders.ts`                        |
| `/api/leaders/teams`           | `routes/leaders.ts`                        |
| `/api/leaders/sparklines`      | `routes/leaderSparklines.ts`               |
| `/api/teams`                   | `routes/teams.ts`                          |
| `/api/teams/:slug/...`         | `routes/teams.ts`                          |
| `/api/games/recent`            | `routes/games.ts`                          |
| `/api/h2h/teams`               | `routes/h2h.ts`                            |
| `/api/h2h/players`             | `routes/h2h.ts`                            |
| `/api/constellation`           | `routes/constellation.ts`                  |
| `/api/rankings`                | `routes/rankings.ts`                       |
| `/api/seasons`                 | `routes/seasons.ts`                        |

Routes that **must not** be cached: `/api/health`, `/api/freshness`, anything
that exposes deploy metadata (those are how clients learn the snapshot has
turned over).

### Layer 2 — ETag / Cache-Control on the wire

For every cacheable response:

- Compute `etag = "W/\"<sha1(payload).slice(0,16)>\""` once at cache fill.
- Send headers:
  ```
  ETag: W/"abc123def4567890"
  Cache-Control: public, max-age=30, stale-while-revalidate=300
  Vary: Accept-Encoding
  ```
- Honour `If-None-Match` in the request — if it matches the cached etag, reply
  `304 Not Modified` with no body. This collapses repeat fetches from ~5–30 KB
  to ~150 bytes.

Keep `max-age` small (30 s) so a deploy-driven content change is picked up
quickly even by stale tabs; rely on `stale-while-revalidate` for a smooth
reload.

### Snapshot epoch (deploy invalidation)

Container start reads (or computes) a snapshot identifier from the DB file
mtime / a sidecar file from the deploy bundle:

```ts
// packages/server/src/snapshot.ts
export const SNAPSHOT_EPOCH = computeSnapshotEpoch(dbPath);
```

- Mix the epoch into every etag and every cache key so a redeploy with a new DB
  invalidates everything atomically without a manual flush.
- Expose it on `/api/health` so the web client can detect a snapshot change and
  refresh stale data.

### Where it sits in the request flow

```
client ── If-None-Match ──► Fastify onRequest hook
                                │
                       cache hit & etag match? ── yes ──► 304 (no body)
                                │ no
                       cache hit?               ── yes ──► 200 + cached body
                                │ no
                              route handler ──► SQL ──► JSON
                                │
                       onSend hook stores {etag, body}, sets headers ──► 200
```

## Scope

**In:**

- New `packages/server/src/plugins/responseCache.ts` (LRU + hooks).
- New `packages/server/src/snapshot.ts` (epoch).
- Wire registration in `packages/server/src/app.ts`.
- Per-route opt-in via a small `{ cache: { ttlMs, vary?: string[] } }` decorator
  passed into route registration helpers (or a route-name allowlist).
- Add `lru-cache` to `packages/server/package.json` (~10 KB dep, MIT, used by
  most of npm).
- Tests in `packages/server/src/__tests__/responseCache.test.ts`:
  cache hit path, `If-None-Match` 304 path, query-string normalisation,
  no-cache routes (`/api/health`), epoch invalidation.

**Out:**

- CDN / reverse-proxy work — `Cache-Control` is enough for browsers and any
  future CDN to do the right thing.
- Per-user caching — there are no authenticated routes; the dataset is public.
- Web-side service worker caching (separate proposal if we ever ship one).
- Materialized leaderboard tables (deferred — measured impact below makes it
  unnecessary at current data volume).

## Validation plan

Baseline numbers we should record before and after:

1. **Server CPU per dashboard load** — `time curl` six dashboard endpoints
   sequentially against `pnpm --filter @pll/server dev`. Expect first run
   ~150–250 ms cumulative SQLite time, second run ~5 ms (all cache hits).

2. **Wire bytes per refresh** — Chrome devtools "Network" panel, dashboard
   refresh:
   - Before: full JSON payloads on every refresh.
   - After (with `If-None-Match`): mostly `304 Not Modified`, ~150 B each.

3. **Cold-start TTFB** — restart container, hit dashboard. Layer-1 cache is
   cold, so this is unchanged; we measure it to make sure we didn't regress.

4. **Unit tests**: assert `x-cache: HIT` on second identical call, `304` on
   `If-None-Match` match, no caching on `/api/health`, cache miss after
   simulated epoch bump.

5. **Load smoke**: `oha -z 30s http://localhost:3001/api/leaders/players?metric=points`
   before/after — expect requests/sec to jump 10×+ once warm.

**Acceptance gate:** dashboard repeat-load (warm cache) drops ≥ 80% of bytes
transferred and ≥ 90% of server SQLite time vs. cold load.

## Effort estimate

| Task                                              | Effort  |
|---------------------------------------------------|---------|
| `responseCache.ts` plugin + LRU + hooks           | 0.5 day |
| `snapshot.ts` + wire into etag + `/api/health`    | 0.25 day|
| Per-route opt-in plumbing                         | 0.25 day|
| Tests (unit + integration)                        | 0.5 day |
| Manual smoke + numbers in PR description          | 0.25 day|
| **Total**                                         | **~1.75 days** |

One PR, server-only, no schema migration, no client change required (clients
benefit transparently via standard HTTP cache semantics).

## Risk

- **Stale data on deploy** — mitigated by snapshot-epoch in cache key + etag.
  Worst case a tab open during deploy keeps a cached payload for `max-age` (30s).
- **Memory pressure** — LRU bounded by entries; even 500 × 30 KB ≈ 15 MB,
  trivial against the 1 Gi container limit.
- **Dynamic query-string ordering** — must normalise `?b=1&a=2` and `?a=2&b=1`
  to the same key. Use sorted `URLSearchParams` in the cache-key builder.
- **`Vary` correctness** — gzip / br differ in body; `Vary: Accept-Encoding`
  must be set so a gzip-aware browser doesn't get a brotli payload.
- **Test flakiness from LRU eviction in tests** — inject a clock for TTL
  assertions; do not assert on `Date.now()` directly.

## Open questions

1. Should TTL be 30 s, 5 min, or "infinite until snapshot epoch changes"? The
   data is genuinely static between deploys — infinite is correct in theory but
   harder to debug ("why didn't my fix appear?"). Suggest starting at 60 s and
   expanding once we trust the epoch invalidation.
2. Do we want to cache `/api/anomalies`? It's read-only between deploys today
   but could become user-mutable if we add a triage UI. Recommend yes for now,
   revisit when triage lands.
3. Should we precompute and warm the cache on container boot (e.g., dashboard's
   six endpoints) to neutralise cold-start latency? Adds ~100 ms to startup but
   makes the first user's experience match the second's. Nice-to-have, not in
   initial scope.
4. Brotli compression — `@fastify/compress` would compound the win. Out of
   scope for this RFC but worth a follow-up doc if numbers warrant.
