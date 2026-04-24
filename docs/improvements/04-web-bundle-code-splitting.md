# 04 — Web bundle code-splitting per view

## Motivation

The web app is a tab-based SPA. A user landing on the Dashboard does not need
the Constellation graph, the H2H comparator, the Anomalies triage list, or any
PIXI rendering code. Today they download all of it on first paint.

`packages/web/src/main.ts` imports nine views statically:

```ts
import * as dashboard from './views/dashboard.js';
import * as teamDetail from './views/teamDetail.js';
import * as gameDetail from './views/gameDetail.js';
import * as playerDetail from './views/playerDetail.js';
import * as dataQuality from './views/dataQuality.js';
import * as leaders from './views/leaders.js';
import * as anomalies from './views/anomalies.js';
import * as graph from './views/graph.js';
// ...
```

Only `scrubber`, `constellation`, and `schedule` are lazy (per the comments in
`main.ts`). Everything else lands in `index-*.js`, the entry chunk.

Measured today:

```
$ find packages/web/dist/assets -name '*.js' ! -name '*.map' | xargs ls -l
...
403,702  index-Cl-jdwwg.js          ← 394 KB main bundle (every page)
 68,534  WebGLRenderer-CH49UgPo.js  ← PIXI, only graph/constellation
 46,417  RenderTargetSystem-...
 43,179  browserAll-...
 40,000  WebGPURenderer-...
 35,603  Text-...
   ...
   5,856 constellation-C1hgLXc-.js  ← view-specific chunk: tiny
   5,333 comparePlayers-...
   3,435 schedule-...
```

Total served JS = **713 KB uncompressed**. Of that, the entry bundle is
**394 KB (55%)** that every visitor pays for on every cold load. The
"3.7 MB dist" figure includes 1.8 MB of `index-*.js.map` plus other source
maps; the actual served JS is much smaller, but the entry chunk is still
the dominant cost.

The goal: bring the entry chunk to **< 150 KB** (ideally < 100 KB) so the
Dashboard paints with router + shell + dashboard view only, and every other
view loads on click.

## Current state

**Routing:** hash-based router in `packages/web/src/router.ts` calls each
view's `render()` / `destroy()`. The router doesn't care whether the view is
imported statically or via `import()`.

**Lazy already:**

- `graph` view — already dynamic (PIXI chunks split out cleanly: ~250 KB total
  PIXI weight is *only* loaded when a user navigates to graph/constellation).
- `scrubber` view — dynamic, per `main.ts` comments.
- `constellation`, `schedule` — partially lazy (chunks exist but check the
  static `import * as` lines too).

**Eager and shouldn't be:**

| View                | LOC (`packages/web/src/views/`) | Dependencies that could split out |
|---------------------|----------------------------------|------------------------------------|
| `dashboard.ts`      | ~600                             | `charts/horizontalLeaderboard`, `components/postImage` |
| `leaders.ts`        | ~700                             | `charts/sparkline`, `charts/horizontalLeaderboard` |
| `teamDetail.ts`     | ~500                             | game thumbs, badges                |
| `gameDetail.ts`     | ~400                             | game thumb renderer                |
| `playerDetail.ts`   | ~400                             | charts                             |
| `h2h.ts`            | ~500                             | comparator-only widgets            |
| `anomalies.ts`      | ~600                             | `anomaliesFilter`, table widgets   |
| `dataQuality.ts`    | ~300                             | sources widgets                    |

Each of these is reachable only via a nav click; users typically visit 2–3 per
session.

**Vite config** (`packages/web/vite.config.ts`):

```ts
export default defineConfig({
  build: { target: 'es2022', sourcemap: true },
});
```

No `manualChunks`, no `chunkSizeWarningLimit`, no compression. Default Rollup
splitting is doing fine on dynamic imports — the problem is just that we
don't *use* dynamic imports for most views.

## Proposed design

Three changes, smallest to largest:

### 1. Convert eager view imports to dynamic imports

Replace each `import * as foo from './views/foo.js'` in
`packages/web/src/main.ts` with a lazy loader that the router awaits:

```ts
// Before
import * as dashboard from './views/dashboard.js';

// After
const loadDashboard = () => import('./views/dashboard.js');
```

Inside the route handler:

```ts
case 'dashboard': {
  const mod = await loadDashboard();
  await mod.render(routeMatch, ctx);
  destroyCurrent = mod.destroy;
  break;
}
```

This already works for the `graph`/`scrubber`/`constellation` views; we are
generalising that pattern. Vite/Rollup will produce one chunk per view
automatically.

Touch list:

- `packages/web/src/main.ts` — convert 7 static imports to dynamic
  (`dashboard`, `teamDetail`, `gameDetail`, `playerDetail`, `leaders`,
  `h2h`, `anomalies`, `dataQuality`).
- Keep `apiBase`, `router`, `components/searchBox`, and the nav `NAV` array
  static — they are needed for first paint.

### 2. Show a route-loading indicator

A 30–80 KB chunk over a slow link is noticeable. Add a tiny loading state in
the route handler:

```ts
async function navigate(match: RouteMatch) {
  showRouteSpinner();           // already exists in shell? if not, ~10 LOC
  try {
    const mod = await loaders[match.name]();
    await mod.render(match, ctx);
  } finally {
    hideRouteSpinner();
  }
}
```

If a view is already in the module cache (re-navigated), the `import()` resolves
synchronously on the next microtask — no spinner flash for repeat visits.

### 3. Prefetch likely next views on idle

Use `requestIdleCallback` (with a `setTimeout` fallback) to warm the most-likely
next views *after* the dashboard has painted:

```ts
function prefetchLikelyViews() {
  const idle = (window as any).requestIdleCallback ?? ((cb: any) => setTimeout(cb, 200));
  idle(() => { void import('./views/leaders.js'); });
  idle(() => { void import('./views/teamDetail.js'); });
}
```

This trades zero TTI cost for near-instant secondary navigation. Vite emits
`<link rel="modulepreload">` automatically once the chunk is requested, so the
browser warms cache cheaply.

### Optional follow-ups (out of initial scope)

- `manualChunks` to group chart helpers (`charts/horizontalLeaderboard`,
  `charts/sparkline`) into a shared `charts` chunk so multiple views share a
  cache entry rather than duplicating ~5 KB each.
- Add `vite-plugin-compression` to emit `.br` / `.gz` on build — pairs nicely
  with the `Cache-Control` work in proposal 03.
- `build.sourcemap: 'hidden'` to keep maps for error tracking but stop shipping
  1.8 MB of `.map` references in production HTML. (Production users currently
  fetch the map only on devtools open, but the file size is wasted disk in the
  container image.)

## Scope

**In:**

- Convert 7 view imports in `packages/web/src/main.ts` from static to dynamic.
- Add route spinner (small CSS + DOM toggle in the shell).
- Add idle-prefetch for `leaders` and `teamDetail` (most-likely next routes
  from Dashboard).
- Update `packages/web/src/views/__tests__/` if any test relies on static
  imports of view modules.
- Smoke-test the full nav flow in `pnpm --filter @pll/web dev` and a built
  preview (`pnpm --filter @pll/web build && pnpm --filter @pll/web preview`).

**Out:**

- `manualChunks` tuning (separate follow-up — needs a chunk-graph audit).
- Compression plugin / brotli (deferred to its own PR).
- Server-side rendering, framework migration, or any structural rewrite.
- Web Vitals instrumentation (worth doing but not blocking on this).

## Validation plan

1. **Bundle size diff** — `du -sh packages/web/dist/assets/index-*.js` before
   and after. Target: entry chunk < 150 KB (currently 394 KB).
2. **Per-view chunks exist** — `ls packages/web/dist/assets/{dashboard,leaders,
   teamDetail,playerDetail,h2h,anomalies,dataQuality,gameDetail}-*.js` should
   show 8 separate chunks.
3. **Network panel inspection** — load the Dashboard fresh:
   - Before: 1 entry chunk + PIXI chunks (graph already lazy).
   - After: 1 entry chunk (smaller) + 1 dashboard chunk + shared chart chunk.
   - Click "Leaders" → exactly one new `leaders-*.js` request.
4. **First contentful paint** — Lighthouse run against `vite preview` build,
   throttled to "Slow 4G". Target: TTI improvement of ≥ 200 ms (proportional to
   the ~250 KB removed from the entry).
5. **No regressions** — full vitest pass:
   ```
   pnpm --filter @pll/web test
   pnpm --filter @pll/web typecheck
   pnpm --filter @pll/web build
   ```
6. **Manual click-through** of every nav item to confirm no view fails to
   load. Worth special attention: the `destroy()` lifecycle for charts —
   ensure it still runs for dynamically-loaded modules (current scrubber/
   constellation pattern in `main.ts` is the template).

## Effort estimate

| Task                                                       | Effort  |
|------------------------------------------------------------|---------|
| Convert 7 view imports to dynamic + adjust router glue     | 0.5 day |
| Route-loading spinner (CSS + DOM toggle)                   | 0.25 day|
| Idle prefetch helper + wire it into post-paint hook        | 0.25 day|
| Test fix-ups (any view-import sites)                       | 0.25 day|
| Manual nav smoke + Lighthouse capture for PR description   | 0.25 day|
| **Total**                                                  | **~1.5 days** |

Single PR, web-only, no API contract change.

## Risk

- **`destroy()` lifecycle bugs** — if a user navigates away while a view's
  dynamic import is still in flight, the resolved `render()` could mount onto
  a now-detached DOM. Mitigate with a per-navigation token: the route handler
  ignores the resolved module if the user has navigated away.
- **Spinner flashes for cached chunks** — once a view's chunk is in module
  cache, `import()` resolves in a microtask; the spinner would flicker.
  Mitigate by only showing the spinner if `import()` hasn't resolved within
  100 ms (`Promise.race` against a `setTimeout`).
- **Source-map references** — `vite build` emits `//# sourceMappingURL` lines
  in every chunk. Existing behaviour — not a regression — but worth noting in
  case we ship maps publicly.
- **Idle prefetch on metered connections** — `requestIdleCallback` doesn't
  honour `navigator.connection.saveData`. Cheap to gate on it:
  `if (!navigator.connection?.saveData) prefetch...`.
- **Test brittleness** — any vitest that does `import * as dashboard from
  '../views/dashboard.js'` continues to work; the change is in `main.ts` only.

## Open questions

1. Do we want a global "view loading" overlay or per-section skeletons? Overlay
   is cheaper to ship; skeletons feel better. Recommend overlay for v1, revisit
   if Lighthouse flags layout shift.
2. Should we adopt `manualChunks` now to bundle the charts helpers into one
   shared chunk, or wait until duplication is measured? Recommend wait — Rollup
   is decent at hoisting shared modules, and premature `manualChunks` can hurt
   more than it helps.
3. Is there appetite for a service worker that precaches all view chunks at
   install time? Would make repeat visits truly instant but adds a non-trivial
   maintenance surface (cache invalidation on deploy). Out of scope here, but
   complementary with the snapshot-epoch plumbing in proposal 03.
4. Should we stop emitting source maps for production (`sourcemap: 'hidden'`)?
   Saves ~1.8 MB on disk in the container image. Doesn't help wire bytes to
   end users (maps load on devtools open only). Probably yes, but separable.
