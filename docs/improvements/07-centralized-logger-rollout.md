# 07 — Centralized logger rollout for `@pll/ingest`

## Motivation

The ingest package has **317 raw `console.*` calls** (283 `console.log`,
23 `console.error`, 10 `console.warn`), almost all concentrated in
`packages/ingest/src/scripts/` (296 of 317). The other three packages
together emit **4** console calls (server: 1, web: 3, shared: 0). That
asymmetry is the entire problem in one number.

Today this works because ingest is a developer-run CLI tool. But it
already hurts in concrete ways:

1. **Test noise** — vitest output for ingest is polluted by script-side
   `console.log` calls that leak through shared modules, making real
   failures harder to spot. CI logs are unreadable on a failed run.
2. **No log levels in practice** — operators can't quiet a script.
   `node script.ts 2>/dev/null` is the only off switch, and it also
   hides genuine errors.
3. **No structured fields** — every `console.log("merged", id, count)`
   is an ad hoc string. Grepping for "how many players got merged in
   the last dedup run" requires reading source.
4. **Production trajectory** — the moment any ingest script runs on a
   schedule (cron, GitHub Action, container) we need machine-parseable
   logs. We don't have them.
5. **One existing `console.error` lives in `packages/server/src`**;
   adding a logger to the server before it grows is essentially free.

This is the highest-volume, lowest-risk piece of cleanup available in
the repo. There are no architectural unknowns — we are replacing one
function call with another and adopting one dependency.

## Current state

### Inventory

```
$ grep -rho "console\.\w*" packages/ingest/src/ | sort | uniq -c
 283 console.log
  23 console.error
  10 console.warn
```

By directory inside `packages/ingest/src/`:

| Directory      | console calls |
| -------------- | ------------- |
| `scripts/`     | 296           |
| `cli/`         | 19            |
| `parsers/`     | 0             |
| `pipelines/`   | 0             |
| `queries/`     | 0             |
| `normalize/`   | 0             |
| `sources/`     | 0             |
| `migrations/`  | 0             |
| `__tests__/`   | 0             |

The pure-data layers (parsers, pipelines, queries, normalize, sources,
migrations) are already silent. **The debt is entirely in the
script + CLI surface.** That changes the rollout calculus: we are not
threading a logger through the entire codebase, we are replacing it at
the leaves.

### Other packages

- `packages/server/src` — 1 `console.*` call. No logger configured on
  the Fastify instance (Fastify ships with Pino by default but is
  almost certainly running with `logger: false` or unconfigured).
- `packages/web/src` — 3 calls. Browser-side. Out of scope for this
  RFC (web should keep `console` for dev-tools ergonomics).
- `packages/shared/src` — 0. Stays that way.

### What the calls look like

The 296 script-side calls are mostly progress reporting:

```ts
// packages/ingest/src/scripts/*.ts (representative)
console.log(`Found ${rows.length} candidates`);
console.log(`  -> merging ${a.id} into ${b.id}`);
console.error(`Failed to fetch ${url}:`, err);
```

There is no convention for prefixes, levels, or structured fields.

### No existing logger contract

`packages/shared/src/index.ts` is 258 lines of pure types; there is no
shared `Logger` interface, no abstract base, no agreed shape. Anything
we add lands on green field.

## Proposed design

### Pick: Pino

- Used by Fastify already, so server adoption is one config flag.
- Fast enough for ingest scripts (won't add measurable runtime).
- Pretty-printer (`pino-pretty`) for dev, JSON for prod — same logger
  config, two transports.
- Tiny API surface: `log.info`, `log.warn`, `log.error`, `log.debug`,
  `log.child({ ... })`.
- No transitive ecosystem lock-in — easy to swap if we ever regret it.

### Where it lives

Add a new file `packages/shared/src/logger.ts`:

```ts
import pino, { type Logger } from 'pino';

export type { Logger };

export interface CreateLoggerOpts {
  name: string;          // e.g. 'ingest:dedupPlayers' or 'server'
  level?: pino.Level;    // default: env LOG_LEVEL || 'info'
  pretty?: boolean;      // default: process.stdout.isTTY
}

export function createLogger(opts: CreateLoggerOpts): Logger {
  const level = opts.level ?? (process.env.LOG_LEVEL as pino.Level) ?? 'info';
  const pretty = opts.pretty ?? Boolean(process.stdout.isTTY);
  return pino({
    name: opts.name,
    level,
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  });
}
```

Re-export from `packages/shared/src/index.ts`:

```ts
export { createLogger, type Logger } from './logger.js';
```

### Adoption pattern

Each script gets one line at the top:

```ts
// packages/ingest/src/scripts/dedupPlayers.ts
import { createLogger } from '@pll/shared';
const log = createLogger({ name: 'ingest:dedupPlayers' });

// before:
console.log(`Found ${rows.length} candidates`);
// after:
log.info({ count: rows.length }, 'found candidates');
```

CLI entry points (`packages/ingest/src/cli/*.ts`) follow the same
pattern.

For the server, replace the existing `Fastify({})` constructor with:

```ts
import { createLogger } from '@pll/shared';
const fastify = Fastify({ logger: createLogger({ name: 'server' }) });
```

This wires Fastify's per-request logging through the same pipeline for
free.

### Lint guard

Add an ESLint rule (or, since we don't have ESLint configured, a
simple grep-based check in CI) to prevent regression:

```bash
# scripts/lint-no-console.sh
violations=$(grep -rn "console\." packages/ingest/src/ packages/server/src/ \
  | grep -v "// allow-console" | wc -l)
if [ "$violations" -gt 0 ]; then
  echo "❌ console.* call found in ingest/server (use createLogger)" >&2
  exit 1
fi
```

Web is exempt by path. Per-line `// allow-console` escape hatch covers
the rare case where a script genuinely wants stdout (e.g. emitting
machine-readable output to a pipe).

### Convention

| Level   | When                                                   |
| ------- | ------------------------------------------------------ |
| `error` | Operation failed; caller should see and act            |
| `warn`  | Suspicious data or recoverable degradation             |
| `info`  | Normal lifecycle events (start, stop, summary counts)  |
| `debug` | Per-row / per-iteration noise (off by default)         |
| `trace` | Reserved; not used initially                           |

Most existing `console.log` calls are progress chatter and should land
as `debug`, not `info`. That alone makes vitest output readable.

## Scope

In scope:

- New file `packages/shared/src/logger.ts` (~40 lines).
- Re-export from `packages/shared/src/index.ts`.
- Add `pino` and `pino-pretty` to `packages/shared` dependencies.
  - `pino-pretty` should be a regular dep so it works in both ingest
    and server runtimes; it is small (~150 KB).
- Replace 317 `console.*` calls across:
  - `packages/ingest/src/scripts/` (296 calls, ~25 files)
  - `packages/ingest/src/cli/` (19 calls, ~3 files)
  - `packages/server/src/` (1 call)
- Wire Fastify to use the shared logger in
  `packages/server/src/app.ts`.
- Add `scripts/lint-no-console.sh` and call it from a `pretest` hook
  or a top-level `lint` script.
- Update `README.md` with one paragraph on `LOG_LEVEL` env var.

Out of scope:

- Web package (`packages/web/src` keeps `console`).
- Test files (vitest's own output stays as-is).
- Log shipping / aggregation infra. Pino emits JSON; that is enough.
- Renaming or restructuring scripts.
- Removing `console.error` from generated migrations or
  `node_modules`.

## Validation plan

1. **Type check passes** for all four packages (`pnpm -r typecheck`).
2. **Existing tests still green** (`pnpm -r test`). Some snapshot
   tests may capture log output; updates allowed but flagged in the
   PR description.
3. **Per-script smoke test** — for each touched script, run it
   against `fixtures/` or a copy of `data/lacrosse.db` and confirm
   exit code 0 and human-readable output with `pino-pretty` active.
4. **Server boot** — `pnpm dev`, hit `/api/health`, confirm Fastify
   logs request line via Pino in JSON form when `LOG_LEVEL=info` and
   no `TTY`.
5. **Lint guard fails on regression** — temporarily add
   `console.log('x')` to an ingest script, confirm
   `scripts/lint-no-console.sh` exits non-zero, then revert.
6. **Quiet-mode check** — `LOG_LEVEL=error pnpm ingest` produces no
   chatter, only errors if any.
7. **Test noise reduction** — run `pnpm --filter @pll/ingest test`
   before and after; expected: vitest stdout shrinks materially.
   Capture before/after line counts in the PR.

## Effort estimate

| Phase                                        | Effort    |
| -------------------------------------------- | --------- |
| Add logger module + dep + re-export          | 1 hr      |
| Migrate `cli/` (19 calls, ~3 files)          | 1 hr      |
| Migrate `scripts/` (296 calls, ~25 files)    | 4–6 hrs   |
| Wire Fastify + server `console` cleanup      | 30 min    |
| Lint guard script + wire into `package.json` | 30 min    |
| README + per-script smoke testing            | 1 hr      |
| **Total**                                    | **8–10 hrs** |

Largely mechanical; suitable for a single sitting or split across a
few short PRs (one per directory). Recommended split:

1. Logger module + shared export + lint guard (no behavioral change).
2. CLI migration.
3. Scripts migration (can be subdivided alphabetically if needed).
4. Server Fastify wire-up.

## Risk

- **Low — Pino transport in non-TTY environments**: `pino-pretty` is
  fine in a TTY, but in CI or container runs we want raw JSON. The
  `pretty` default keys off `process.stdout.isTTY`, which handles
  this correctly. Verify in the validation step.
- **Low — script output that scripts (the human kind) consume**: a
  few scripts emit lines that the developer copy-pastes (e.g. SQL
  fragments). For those, mark with `// allow-console` and keep as
  `console.log`. Audit during migration.
- **Low — bundle size for `web`**: not affected; web doesn't import
  the logger and Vite will tree-shake the re-export.
- **Low — perf**: Pino is faster than `console.*` in practice. No
  measurable risk for ingest workloads.
- **Medium — log message changes break log-scraping consumers**: no
  known consumers exist today, but if any ad hoc `grep` workflows
  exist (e.g. a teammate parses script output), they will need
  updating. Document the level/format conventions in the README.

## Open questions

1. Do we want a `child` logger per migration / per pipeline run
   pre-bound with `runId`, so multi-step pipelines correlate? Cheap
   to add later, no blocker.
2. Should `LOG_LEVEL=debug` be the default in `pnpm dev` so server
   request logs show in the dev pane? Probably yes — set in
   `package.json` script.
3. Do we need `pino-roll` or file rotation for any scheduled ingest
   job? Out of scope here; revisit if/when we set up cron.
4. Is there an appetite for ESLint in this repo? If so, the lint
   guard becomes one rule (`no-console` with allowlist) instead of a
   bash script. Either is fine; bash ships sooner.
