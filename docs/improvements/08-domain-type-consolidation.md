# 08 — Domain type consolidation in `@pll/shared`

## Motivation

`@pll/shared` exists for exactly one reason, stated at the top of
`packages/shared/src/index.ts`:

> All ingest, server, and web packages import from here so the data
> shape is the single source of truth across the monorepo.

That promise is currently broken. We have **268 exported types and
interfaces across the four packages** and only **30 of them live in
`@pll/shared`**. The rest are scattered across consumers, and several
are demonstrably duplicated:

| Type            | Defined in                                                                                                         | Drift risk |
| --------------- | ------------------------------------------------------------------------------------------------------------------ | ---------- |
| `PiaaRecord`    | `@pll/shared/src/index.ts:28` **and** `@pll/ingest/src/queries/piaa.ts:14`                                         | High       |
| `PlayerRow`     | `@pll/server/src/queries/mappers.ts:62`, `@pll/ingest/src/scripts/dedupPlayers.ts:41`, `dedupCrossTeam.ts:43`     | High       |
| `ScoringEvent`  | `@pll/server/src/queries/games.ts:33` **and** `@pll/web/src/api.ts:327`                                            | **Critical** — API boundary |
| `TeamRow`       | server + ingest (×2)                                                                                                | High       |
| `H2H*` family   | `@pll/server` and `@pll/web` (×2 each: `H2HTeamSide`, `H2HPlayerSide`, `H2HDirectMeeting`, `H2HCommonOpponent`, `H2HCategoryLead`) | **Critical** — API boundary |
| `Rivalry*`      | server + web duplicates of `RivalryNode`, `RivalryEdge`                                                            | **Critical** — API boundary |
| `SearchHit`     | server + web                                                                                                        | **Critical** — API boundary |
| `ScheduleByDate`| server + web                                                                                                        | **Critical** — API boundary |
| `SeasonsResponse`| server + web                                                                                                       | **Critical** — API boundary |
| `TeamLeaderRow`, `PlayerLeaderRow` | server + web                                                                                  | **Critical** — API boundary |
| `MergeAction`, `SeedResult`, `FetchScheduleOpts` | various ingest/server                                                          | Medium     |

The "Critical" rows are the dangerous ones: any time the server's
shape and the web client's shape disagree silently, the bug presents
as a runtime undefined property in the UI — exactly the failure mode
TypeScript is supposed to prevent. Today nothing prevents it; the two
files are kept in sync by hand.

`PiaaRecord` is the most embarrassing case: someone already added it
to shared (commented as "single source of truth") and then ingest
re-declared it locally anyway.

## Current state

### Counts

```
packages/ingest/src   115 exported types/interfaces
packages/web/src       88
packages/server/src    35
packages/shared/src    30
                      ---
                      268 total
```

`@pll/shared/src/index.ts` is a single 258-line file containing the
*intentionally shared* types: `Gender`, `Division`, `RankingSource`,
`ParserStrategy`, `PiaaRecord`, `CoverageRecord`, `DerivedRecord`,
`PiaaValidation`, etc. The structure is fine; the **inventory is
incomplete**.

### Concrete duplicate examples

```ts
// packages/shared/src/index.ts:28
export interface PiaaRecord {
  wins: number; losses: number; ties: number;
  seed: number | null;
  classification: string;
  ranking: number;
  totalPoints: number;
  nameOfficial: string;
}

// packages/ingest/src/queries/piaa.ts:14
export interface PiaaRecord { /* re-declared */ }
```

```ts
// packages/server/src/queries/games.ts:33
export interface ScoringEvent { /* server-side shape */ }

// packages/web/src/api.ts:327
export interface ScoringEvent { /* hand-maintained client shape */ }
```

The web side of the API boundary has its own `api.ts` with hand-typed
response shapes. There is no contract test that confirms server and
web agree.

### Why this matters now

- The repo has 19 server route files (`packages/server/src/routes/`)
  and a corresponding `web/src/api.ts` of comparable surface area.
- We just added new visualizations (constellation, rivalries, H2H);
  these are exactly the types that drifted.
- We are about to do a logger rollout (RFC 07) and possibly other
  refactors; landing this consolidation first means those refactors
  touch one type definition instead of two or three.

## Proposed design

### Principle

> If a type crosses a package boundary, it lives in `@pll/shared`.
> Period.

A type is "crossing a boundary" if any of:

1. It appears in an HTTP request or response body (server ↔ web).
2. It is imported by more than one package.
3. It models a row that maps to a domain entity (Game, Player, Team,
   Stat, Ranking, PiaaRecord) — even if currently only one package
   uses it. These are domain shapes; locality is an accident.

Local-only types (helper tuples inside one parser, internal pipeline
state, Fastify route generics) **stay local**. We are not trying to
centralize everything; we are centralizing the contract surface.

### Target structure

Split `@pll/shared/src/index.ts` (currently one 258-line file) into a
flat module tree. Each module groups types by domain, not by
consumer:

```
packages/shared/src/
├── index.ts              // re-exports everything, keeps existing import paths working
├── logger.ts             // (from RFC 07, if landed)
├── domain/
│   ├── core.ts           // Gender, Division, Season, etc.
│   ├── team.ts           // TeamRow, TeamLeaderRow, TeamBranding
│   ├── player.ts         // PlayerRow, PlayerLeaderRow, PlayerAlias
│   ├── game.ts           // Game, ScoringEvent, ScheduleByDate
│   ├── stats.ts          // PlayerStat, StatSource, aggregations
│   ├── piaa.ts           // PiaaRecord, PiaaValidation, CoverageRecord
│   ├── rankings.ts       // RankingSource, RankingEntry
│   ├── parser.ts         // ParserStrategy, anomaly types
│   └── search.ts         // SearchHit
└── api/
    ├── h2h.ts            // H2HTeamSide, H2HPlayerSide, H2HDirectMeeting, ...
    ├── rivalries.ts      // RivalryNode, RivalryEdge, RivalriesResponse
    ├── seasons.ts        // SeasonsResponse
    ├── schedule.ts       // ScheduleResponse
    ├── leaders.ts        // LeadersResponse
    └── constellation.ts  // ConstellationResponse
```

`domain/` = data shapes (DB rows, derived entities). `api/` =
request/response envelopes that exist only because of HTTP. The
distinction matters because `api/` types are the contract; renaming
one is a breaking change to the web client.

### Migration approach

Per duplicated type, in order of risk (Critical → High → Medium):

1. Pick the canonical definition (usually the most complete one).
2. Move it into the appropriate `packages/shared/src/{domain,api}/*.ts`.
3. Add to `packages/shared/src/index.ts` re-exports.
4. Replace each duplicate with `import type { X } from '@pll/shared'`.
5. Delete the local declaration.
6. `pnpm -r typecheck` — fix fallout (this is where field-name
   drift surfaces; treat each conflict as a real bug to investigate,
   not a cosmetic merge).

### Contract test for the API surface

Add `packages/server/src/__tests__/api-contract.test.ts`:

```ts
// For each route response type imported from @pll/shared,
// hit the route against a seeded fixture DB and assert the
// response object satisfies the type. With ts-expect-error
// hygiene we prevent silent shape drift at build time.
```

The test does two things:

1. Imports the response types from `@pll/shared/api/*` (the same
   types `web/src/api.ts` should import).
2. Calls each route with `app.inject(...)` against the seed DB and
   passes the JSON through a runtime validator. We don't need full
   Zod adoption — a thin `assertShape<T>(value)` using
   `Object.keys` comparisons is enough to catch drift.

If we want to go further, generate JSON schemas from the shared
types and have Fastify validate responses. Out of scope here, but
the consolidation makes that future trivial.

### Web side

Replace hand-typed shapes in `packages/web/src/api.ts` with imports:

```ts
// before
export interface ScoringEvent { /* ... */ }
export async function getGame(id: number): Promise<{ ...; events: ScoringEvent[] }> { ... }

// after
import type { Game, ScoringEvent, ScheduleByDate } from '@pll/shared';
export async function getGame(id: number): Promise<Game> { ... }
```

`api.ts` shrinks to network-call code only; types come from shared.

## Scope

In scope:

- Restructure `packages/shared/src/` into `domain/` and `api/`
  subfolders, keeping `index.ts` as a flat re-export so existing
  `import { X } from '@pll/shared'` paths in consumers don't break.
- Migrate the 11 known-duplicate types listed in the Motivation
  table:
  - `PiaaRecord` (delete from `ingest/queries/piaa.ts`)
  - `PlayerRow` (canonicalize from server, delete ingest×2)
  - `TeamRow` (canonicalize from server)
  - `ScoringEvent` (reconcile server vs web — investigate any field
    diff before merging)
  - `H2HTeamSide`, `H2HPlayerSide`, `H2HDirectMeeting`,
    `H2HCommonOpponent`, `H2HCategoryLead` (server vs web)
  - `RivalryNode`, `RivalryEdge` (server vs web)
  - `SearchHit`, `ScheduleByDate`, `SeasonsResponse` (server vs web)
  - `TeamLeaderRow`, `PlayerLeaderRow` (server vs web)
- Update `packages/web/src/api.ts` to import shapes from
  `@pll/shared` rather than re-declare.
- Add `packages/server/src/__tests__/api-contract.test.ts` with one
  test per route in scope (~19 routes; assert shape against shared
  type using a small `assertShape` helper).
- Update `AGENTS.md` (or `README.md`) with the rule: "any type
  crossing a package boundary lives in `@pll/shared`".

Out of scope:

- The 200+ local-only types that don't cross boundaries.
- Adopting Zod / runtime validation (deferred; the contract test is
  the lightweight first step).
- Generating OpenAPI / JSON schema from the types (deferred).
- Renaming any types (mechanical move only — naming changes are a
  separate PR per type if needed).

## Validation plan

1. `pnpm -r typecheck` passes after each duplicate is removed. If a
   merge surfaces a field difference (e.g. server's `PlayerRow` has
   `id: number`, ingest's has `id: string`), **stop and treat it as
   a real data bug**; document and reconcile before continuing.
2. `pnpm -r test` — all 82 existing tests still pass. Several will
   need import updates (mechanical).
3. New `api-contract.test.ts` passes for every route listed in
   `packages/server/src/routes/`.
4. Grep audit:
   ```
   grep -rh "^export \(type\|interface\) " packages/*/src/ \
     | awk '{print $3}' | sort | uniq -d
   ```
   This list should shrink from 20 names to **0** for the
   migrated types. Any remaining duplicates are explicitly
   local-only and documented.
5. Web build (`pnpm --filter @pll/web build`) succeeds with the new
   imports. Verify dev tools network tab against one example route
   to confirm no runtime shape change.
6. Diff `packages/web/src/api.ts` before/after — should lose ~150
   lines of redundant type declarations.

## Effort estimate

| Phase                                                 | Effort      |
| ----------------------------------------------------- | ----------- |
| Restructure `packages/shared/src/` into folders       | 1 hr        |
| Migrate `PiaaRecord` (trivial — already in shared)    | 15 min      |
| Migrate `PlayerRow`, `TeamRow` (3 + 2 sites)          | 1.5 hrs     |
| Migrate `ScoringEvent` (server ↔ web reconcile)       | 1 hr        |
| Migrate `H2H*` family (5 types × 2 sites)             | 2 hrs       |
| Migrate `Rivalry*`, `SearchHit`, `Schedule*`, `Seasons*`, leader rows | 2 hrs       |
| Update `web/src/api.ts` imports + cleanup             | 1 hr        |
| `assertShape` helper + 19 contract tests              | 3–4 hrs     |
| AGENTS.md / README update                             | 30 min      |
| Buffer for field-drift bugs surfaced in step 1        | 2 hrs       |
| **Total**                                             | **14–16 hrs** |

Recommended PR sequence:

1. Restructure shared (no behavioral change, no consumer changes).
2. `PiaaRecord` cleanup (smallest possible change, validates path).
3. Domain rows (`PlayerRow`, `TeamRow`).
4. Each API surface group (H2H, Rivalry, Search, Schedule, Seasons,
   Leaders) as separate PRs.
5. Contract tests + AGENTS.md doc.

Each PR is independently shippable.

## Risk

- **Medium — silent field drift surfacing as bugs**: the whole point
  of this RFC is to expose places where server and web disagreed.
  Some merges will reveal real bugs. That's value, not regression,
  but expect 1–3 actual data-shape fixes during the migration.
- **Low — circular import worries**: `@pll/shared` imports from
  nowhere else in the monorepo (only from `pino` if RFC 07 lands).
  No risk.
- **Low — `import type` vs `import`**: most domain types have no
  runtime, so `import type { ... }` keeps web bundle size flat. Use
  it consistently.
- **Low — version bumps**: `@pll/shared` is `workspace:*` from every
  consumer. No publishing concerns.
- **Medium — touching `web/src/api.ts` is the highest-blast-radius
  change**: it is imported by every page. Keep the per-PR scope
  small and the `tsc` gate strict.
- **Low — contract tests add CI time**: 19 lightweight `app.inject`
  calls against a seeded fixture DB — sub-second.

## Open questions

1. Do we want `domain/` and `api/` as actual subfolders, or keep
   everything flat with prefixed filenames (`api-h2h.ts`)? Folders
   read better; flat is one less index file.
2. Should the contract test go in `@pll/server` or in a new
   `packages/contract-tests/`? Server is fine for now; split if it
   ever needs to import web code.
3. `assertShape` vs Zod: starting with `assertShape` is cheap, but
   Zod gives us runtime validation at the route boundary too. Worth
   a follow-up RFC once this consolidation lands.
4. Once shared owns the API types, do we want to generate the
   OpenAPI spec from them (e.g. via `@fastify/swagger` + type
   reflection)? Deferred; this RFC is a prerequisite either way.
5. Should `PlayerRow` and `Player` be the same type, or do we
   maintain a "DB row" vs "domain entity" split? Today they're the
   same shape; recommend collapsing unless a real difference appears
   during migration.
