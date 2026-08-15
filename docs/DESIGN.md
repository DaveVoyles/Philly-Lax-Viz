# Design System — Philly Lacrosse Vis (Philly Lax Stats)

> Snapshot of this site's **current** design as implemented, documented so a designer or agent can understand the visual system without reading source. Generated 2026-08-14 as part of a cross-site design inventory; source of truth is always the files listed in §Source Files.
>
> This repo contains **two visually distinct experiences** sharing one SPA shell:
> 1. **Main site** — the high-school lacrosse stats hub (dashboard, teams, players, leaders, etc.), a light/dark, data-dense utility UI.
> 2. **Box Lacrosse sub-site ("PBLA")** — the Philadelphia Box Lacrosse Association partnership page at `#/pbla` and `#/pbla/team/:slug`, a premium dark-only marketing page with a WebGL particle background and heavy motion. It is intentionally styled to look and feel like a different product.
>
> Every section below documents the main site first, then a labeled **Box Lacrosse (PBLA) sub-site** subsection where it diverges.

## At a Glance

### Main site
| | |
|---|---|
| Live URL | https://phillylaxstats.com/ |
| Stack / framework | Vite + vanilla TypeScript SPA (hash-based client-side router, no UI framework); D3 (d3-force/d3-scale/d3-shape/d3-selection/d3-axis) for charts; Fastify API backend |
| Styling approach | Global CSS custom properties (`:root` tokens) + plain CSS in `packages/web/src/styles.css`, no Tailwind/SCSS/CSS-in-JS |
| Theme modes | Light + dark, driven entirely by `@media (prefers-color-scheme: dark)` — no in-app toggle |
| Overall vibe | Dense data dashboard: system-font sans-serif, plain white/near-black surfaces, blue accent, tabular-numeric stat tables, subtle card/scroll-reveal motion |

### Box Lacrosse (PBLA) sub-site
| | |
|---|---|
| Live URL | https://phillylaxstats.com/#/pbla (and `#/pbla/team/:slug`) |
| Stack / framework | Same Vite/TS SPA, but the view (`packages/web/src/views/pbla.ts`) injects its own scoped stylesheet and mounts a Pixi.js (`pixi.js` v8) WebGL particle-network canvas behind the content |
| Styling approach | Scoped `<style>` block injected at runtime (`packages/web/src/views/pblaStyles.ts`), namespaced under `.pbla-view-root` / `.pbla-*` classes; CSS custom properties defined locally on `.pbla-view-root`, plus per-team CSS vars (`--team-color`, `--team-secondary`) set inline for gradients/glows |
| Theme modes | **Dark-only**, hardcoded — does not respond to `prefers-color-scheme` or the main site's light mode. WebGL background is skipped on low-power devices / `prefers-reduced-motion` (`shouldMountWebGL()` in `packages/web/src/util/motionPrefs.ts`) |
| Overall vibe | Premium sports-sponsorship pitch page: near-black glassy panels, gold/orange gradient accents, glowing pulsing badges, animated particle-network canvas, staggered card/row reveal animations — reads as a different product skinned onto the same site |

## Color Palette
Real values from code — never approximate.

### Main site — Light mode
| Token / usage | Hex | Where defined | Notes |
|---|---|---|---|
| Primary / brand (accent) | `#1d4ed8` | `packages/web/src/styles.css:5` | Links, active nav pill, buttons, progress bars |
| Background | `#ffffff` | `packages/web/src/styles.css:2` | `--bg` |
| Surface / card (table stripe) | `#f9fafb` | `packages/web/src/styles.css:8` | `--table-stripe`, used for zebra rows, cards, panels |
| Text primary | `#1a1a1a` | `packages/web/src/styles.css:3` | `--fg` |
| Text secondary | `#6b7280` | `packages/web/src/styles.css:4` | `--muted` |
| Border | `#e5e7eb` | `packages/web/src/styles.css:7` | `--border` |
| Error | `#b91c1c` | `packages/web/src/styles.css:9` | `--error` |
| Code background | `#f3f4f6` | `packages/web/src/styles.css:10` | `--code-bg` |
| Success (win / complete) | `#15803d` | `packages/web/src/styles.css:546,562,658` | `.result-w`, `.coverage-note--complete`, `.team-row__gap--complete` |
| Warn (missing / close match) | `#b45309` | `packages/web/src/styles.css:563,778` | `.team-row__gap--missing`, `.piaa-validation-panel--close` |
| Info accent (PIAA extra/teal) | `#0e7490` | `packages/web/src/styles.css:523,564` | `.record-callout--piaa`, `.team-row__gap--extra` |

### Main site — Dark mode
| Token / usage | Hex | Where defined | Notes |
|---|---|---|---|
| Primary / brand (accent) | `#60a5fa` | `packages/web/src/styles.css:18` | |
| Background | `#0b0d10` | `packages/web/src/styles.css:15` | |
| Surface / card (table stripe) | `#11151a` | `packages/web/src/styles.css:21` | |
| Text primary | `#e5e7eb` | `packages/web/src/styles.css:16` | |
| Text secondary | `#9ca3af` | `packages/web/src/styles.css:17` | |
| Border | `#1f2937` | `packages/web/src/styles.css:20` | |
| Error | `#f87171` | `packages/web/src/styles.css:22` | |
| Code background | `#11151a` | `packages/web/src/styles.css:23` | |
| Success (win) | `#4ade80` | `packages/web/src/styles.css:662` | |
| Warn (missing) | `#fbbf24` | `packages/web/src/styles.css:567` | |
| Info accent (PIAA extra/teal) | `#22d3ee` | `packages/web/src/styles.css:568` | |

### PWA / manifest palette (main site)
| Token | Hex | Where defined |
|---|---|---|
| `theme_color` | `#1d4ed8` | `packages/web/public/manifest.json`, `packages/web/index.html` `<meta name="theme-color">` |
| `background_color` | `#ffffff` | `packages/web/public/manifest.json` |

These match light-mode `--ds-accent` / `--ds-bg` in `packages/web/src/styles/tokens.css`.

### Box Lacrosse (PBLA) sub-site — always dark, no light variant
| Token / usage | Hex | Where defined | Notes |
|---|---|---|---|
| Accent (gold) | `#ffd166` | `packages/web/src/views/pbla.css` | `--ds-accent` remapped on `.pbla-view-root`; `--pbla-accent` aliases it |
| Text / "white" | `#f8fafc` | `packages/web/src/views/pblaStyles.ts:11` | `--pbla-white`; headings, primary text (used with `color-mix()` for secondary tints) |
| Muted | `#94a3b8` | `packages/web/src/views/pblaStyles.ts:12` | `--pbla-muted` (declared, lightly used) |
| Ink / base | `#05070d` | `packages/web/src/views/pblaStyles.ts:13` | `--pbla-ink` |
| Panel | `rgba(9, 13, 24, 0.84)` | `packages/web/src/views/pblaStyles.ts:14` | `--pbla-panel`, glassmorphism panel fill |
| Panel (strong) | `rgba(9, 13, 24, 0.94)` | `packages/web/src/views/pblaStyles.ts:15` | `--pbla-panel-strong` |
| Border | `rgba(255, 209, 102, 0.14)` | `packages/web/src/views/pblaStyles.ts:16` | `--pbla-border`, gold-tinted hairline |
| Secondary/glow accent (orange) | `#f68c1f` | `packages/web/src/views/pblaStyles.ts:55` (`rgba(246,140,31,...)`) | Radial glow blobs, kicker border/background, CTA gradient; not tokenized as a CSS var but used consistently as `246, 140, 31` |
| Live badge red | `#ff0000` / `#ff4444` | `packages/web/src/views/pblaStyles.ts:142,155,165,181,193` | Live game pulse badge |
| Win streak green | `#86efac` on `rgba(34,197,94,0.11)` | `packages/web/src/views/pblaStyles.ts:604-607` | `.pbla-streak--win` |
| Loss streak red | `#fca5a5` on `rgba(239,68,68,0.11)` | `packages/web/src/views/pblaStyles.ts:609-612` | `.pbla-streak--loss` |
| Per-team accent | dynamic | `--team-color` / `--team-secondary` set inline per team, consumed via `color-mix()` throughout `pblaStyles.ts` | Team cards, rank pills, table row accents, WebGL particle tint |
| WebGL particle colors | `#f68c1f`, `#ffd166`, `#f8fafc` | `packages/web/src/views/pblaWebGL.ts:6` (`PARTICLE_COLORS`) | Matches the gold/orange/white palette above — the one place the palette is intentionally reused outside CSS |

## Typography
| Role | Family | Size / scale | Weight | Where defined |
|---|---|---|---|---|
| Headings (main site) | System stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Helvetica Neue", Arial, sans-serif` | `h1` 1.85rem / `h2` 1.4rem / `h3` 1.1rem on mobile (≤768px); no explicit desktop override, inherits browser UA default sizing scaled from body | inherits bold UA default | `packages/web/src/styles.css:34-38` (base stack), `:1220-1232` (mobile scale) |
| Body (main site) | Same system stack | `19.2px` base desktop, `17px` at ≤768px, `16px` at ≤480px | 400 | `packages/web/src/styles.css:36,1216,1296` |
| Mono / data (main site) | `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace` | `0.9em` (inline `code`/`pre`) | 400 | `packages/web/src/styles.css:47` |
| Headings (PBLA) | Inherits the same system stack (no separate `font-family` declared in `pblaStyles.ts`) | Hero title `clamp(2.2rem, 4vw, 4rem)`, section title `clamp(1.3rem, 2vw, 1.8rem)`, CTA title `clamp(1.35rem, 2vw, 2rem)` | 800–900 (heavier than main site) | `packages/web/src/views/pblaStyles.ts:97,404,1008` |
| Body (PBLA) | Same system stack | Subtitle `1rem`, section subtitle `0.9rem`, table cell `0.89rem` | 400–700 | `packages/web/src/views/pblaStyles.ts:114,412,718` |

No web fonts (`@font-face` / Google Fonts) anywhere in the repo — both the main site and PBLA sub-site rely entirely on the OS system-font stack. PBLA differs from the main site mainly through **weight** (routinely 700–900 vs. the main site's unstyled default) and **letter-spacing** (`-0.02em` to `-0.04em` on headings, `0.06em`–`0.08em` uppercase tracking on eyebrows/labels) rather than family or base size.

## Spacing & Layout
- **Main site container**: `max-width: 1400px`, `margin: 0 auto`, `padding: 1.5rem 1.25rem 3rem` (`packages/web/src/styles.css:189-193`); tightens to `1rem 0.75rem 2rem` at ≤768px and `0.5rem 0.75rem` at ≤480px.
- **Breakpoints in use** (main site, ad hoc rather than a formal scale): `1040px` is not used on main site but is on PBLA; main site uses `768px` (primary mobile breakpoint, repeated across `styles.css` and `responsive.css`), `700px` (`.table-scroll` column hiding), `640px` (nav hamburger), `480px` (extra-small type/grid squeeze).
- **Spacing scale**: ad hoc rem values (`0.25rem`, `0.4rem`, `0.5rem`, `0.75rem`, `1rem`, `1.25rem`, `1.5rem` …) — no formal 4px/8px token scale, no Tailwind spacing scale.
- **Border radius**: main site is conservative — `4px` (buttons, inputs, badges), `6px` (panels/callouts), `8px` (source cards), `999px` (pills/badges). PBLA is much rounder — `14px`–`20px` on panels/cards, `999px` pills, giving it a softer "product marketing" feel vs. the main site's flatter, boxier `4–8px` radii.
- **Shadow / elevation**: main site uses shadows sparingly — `0 4px 12px rgba(0,0,0,0.15)` on the "More ▾" dropdown (`packages/web/src/styles.css:154`), `0 4px 16px rgba(78,161,255,0.25)` on team-grid hover. PBLA layers multiple shadows per element for depth (glass panels use `inset 0 1px 0 rgba(255,255,255,0.05), 0 24px 60px rgba(0,0,0,0.35)`, plus `backdrop-filter: blur(18px)` — no `backdrop-filter` usage anywhere on the main site) (`packages/web/src/views/pblaStyles.ts:43-46`).

### Box Lacrosse (PBLA) sub-site layout notes
- Hero grid: `grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.9fr)`, collapsing to 1 column at ≤1040px (`packages/web/src/views/pblaStyles.ts:61,1061-1069`).
- Standings/leaders tables use CSS `grid` (not table layout) inside `<thead>`/`<tbody>` rows for column alignment (`packages/web/src/views/pblaStyles.ts:695-711`), unlike the main site's plain HTML `<table>` layout.
- Extra breakpoints unique to PBLA: `1040px`, `720px`, `520px` (`packages/web/src/views/pblaStyles.ts:1060,1070,1111`), in addition to the shared `768px`/`640px`.

## Components
Short inventory of recurring UI pieces and their conventions (buttons, nav, cards, tables, badges, forms). Note variants and where each is implemented.

### Main site
- **Nav / header** — sticky `.site-header` with brand + inline nav links, a "More ▾" dropdown for admin/dev routes, a hamburger menu below 640px, and a right-aligned season picker (`packages/web/src/styles.css:59-186`, `packages/web/src/main.ts`).
- **Buttons** — flat rectangular, `4–6px` radius, solid accent fill (`.anomaly-more`, `.coach-upload__button`) or bordered secondary variant (`.coach-upload__button--secondary`) (`packages/web/src/styles.css:275-284,1029-1048`).
- **Cards** — `.team-grid` team cards, `.record-callout` stat callouts, `.source-card`, all bordered boxes on `--table-stripe`/`--bg` with `4–8px` radius (`packages/web/src/styles.css:314-346,496-539,799-808`).
- **Tables** — plain HTML tables with zebra striping (`tbody tr:nth-child(even)`), a `table.stat` variant with right-aligned numeric columns and clickable/hoverable rows, and `.anomaly-table` (dense, sticky header, scrollable) (`packages/web/src/styles.css:197-212,245-260,305-312`).
- **Badges** — pill-shaped `.badge-*` status chips (pending/approved/rejected/skipped), `.result-badge` (W/L/T/pending), `.piaa-badge` validation indicator, `.team-row__record` chip (`packages/web/src/styles.css:522-530,668-681,733-764,1138-1142,572-583`).
- **Forms** — `.coach-upload__field` labeled inputs/selects with a 2-column responsive grid, alert boxes (`--info`/`--success`/`--error` variants) (`packages/web/src/styles.css:976-1129`).
- **Charts** — D3-rendered inline SVG (`src/charts/*.ts`): season record donut, top scorers bar, per-game trend line, quarter-by-quarter, team score trend, calendar heatmap, sparkline, margin histogram, game flow — all capped to a per-chart `max-width` via `.chart-slot[data-chart="…"]` (`packages/web/src/styles.css:607-656`).

### Box Lacrosse (PBLA) sub-site
- **Glass panels** (`.pbla-panel`) — the base container for every section: rounded (`20px`), translucent, blurred, with a radial glow pseudo-element (`packages/web/src/views/pblaStyles.ts:35-57`). No equivalent exists on the main site.
- **Hero** (`.pbla-hero`) — kicker pill with pulsing dot, gradient-clipped-text title accent, live-game badge with pulsing red dot, goalie stat pills, season toggle bar (`packages/web/src/views/pblaStyles.ts:58-301`).
- **Summary cards** (`.pbla-summary-card`) — animated glowing border (`shimmerBorder` keyframe) and breathing box-shadow (`cardGlow` keyframe) with staggered `animation-delay` per card — a level of chrome the main site never uses on stat tiles (`packages/web/src/views/pblaStyles.ts:308-347`).
- **Team cards** (`.pbla-team-card`) — per-team gradient background and border driven by inline `--team-color`/`--team-secondary` vars, hover sheen sweep, scale/lift on hover, staggered entrance animation (`packages/web/src/views/pblaStyles.ts:459-523`).
- **Data tables** (`.pbla-data-table`, `.pbla-standings-table`, `.pbla-leaders-table`) — CSS-grid-based rows (not native table layout), left-border team-color accent, animated fill-percentage bars behind rows (`.pbla-points-bar`, `.pbla-win-bar`), sortable column headers with custom arrow glyphs (`packages/web/src/views/pblaStyles.ts:683-819`).
- **Game cards** (`.pbla-game-card`) — bordered result cards with playoff-variant glow border and badge (`packages/web/src/views/pblaStyles.ts:886-945`).
- **CTA block** (`.pbla-cta`) — centered gradient-background closing panel with pill links (`packages/web/src/views/pblaStyles.ts:998-1046`).
- **WebGL background** (`.pbla-webgl`) — a full-bleed absolutely-positioned Pixi.js canvas rendering a connected particle network, conditionally mounted (`packages/web/src/views/pblaWebGL.ts`, gated by `shouldMountWebGL()`). No other page in the site uses a canvas/WebGL background.

## Motion & Interaction

### Main site
Present, but restrained: staggered team-card fade-in (`cardFadeIn`, 0.4s), scroll-reveal sections (`slideReveal`, 0.5s via `IntersectionObserver`-driven `.is-visible` class), leader-panel bar-fill grow (`barGrow`, 0.6s), row hover background sweep on recent games, a `newGameFlash` highlight for live-refreshed rows, page-transition fade (`viewFadeIn`/`viewFadeOut`, 120–200ms) on route change, and chart-reveal fade/scale + SVG path-draw/bar-grow animations for D3 charts (`packages/web/src/styles.css:348-417,1304-1374`). All of it is wrapped in `@media (prefers-reduced-motion: reduce)` overrides that disable the animation and snap to the end state.

### Box Lacrosse (PBLA) sub-site
Substantially more animated: a live Pixi.js WebGL particle-network background with connecting lines and click/interaction "burst" effects (`packages/web/src/views/pblaWebGL.ts`, `packages/web/src/components/particleBurst.ts`); pulsing kicker dot and live-game dot (`pbla-pulse`, `pbla-live-pulse`); shimmering gradient borders and breathing glow on summary cards (`shimmerBorder`, `cardGlow`); staggered entrance transitions on team cards, table rows, and game cards using `--delay` custom properties and a spring-like `cubic-bezier(0.34, 1.56, 0.64, 1)` / `cubic-bezier(0.22, 1, 0.36, 1)` easing (main site sticks to plain `ease`/`ease-out`); hover sheen sweep and lift on team cards; animated bar-fill on standings "win %" and "points" bars. Respects `shouldAnimate()`/`shouldMountWebGL()` (`packages/web/src/util/motionPrefs.ts`) to skip the WebGL canvas and reduce motion on low-power devices or `prefers-reduced-motion`, but the CSS keyframe animations in `pblaStyles.ts` are **not** wrapped in a `prefers-reduced-motion` media query the way the main site's `styles.css` animations are — see Known Inconsistencies.

## Imagery & Iconography
- **Team logos**: ~150 static `.gif`/`.png` crest images per school under `data/logos/` (repo-relative, served to the client), rendered via the `.team-badge` component with circular initials-avatar fallback when no logo exists (`packages/web/src/styles.css:690-724`, `packages/web/src/components/teamBadge.ts`).
- **PWA icons**: `icon-192.svg`, `icon-512.svg`, `favicon.svg` under `packages/web/public/` (`packages/web/index.html:29-31`).
- **Iconography**: no icon font/SVG icon library — icons are hand-rolled inline SVG (e.g. the PBLA live-badge broadcast icon, `packages/web/src/views/pblaStyles.ts:168-172`) or emoji/text glyphs (e.g. `piaaBadge.ts` validation icons, anomaly banner `⚠` markers).
- **Photo treatment**: none — no photography is used anywhere in the site; all visuals are charts, logos, and CSS-drawn UI.
- **PBLA-specific**: adds a live particle/network canvas (Pixi.js) as a decorative background layer instead of static imagery — the only place in the repo that uses a canvas-rendered visual as page chrome rather than a data chart.

## Accessibility Notes
- Main site defines `.sr-only` (visually-hidden but screen-reader-readable) utility, used to expose a tabular fallback for the SVG team-strength radar chart (`packages/web/src/styles.css:1179-1190`).
- Focus states: `table.stat tbody tr.row-link:focus`, `.piaa-badge-link`, sortable table headers, and most interactive PBLA elements (`.pbla-live-badge`, `.pbla-season-btn`, `.pbla-team-card`, `.pbla-cta__link`) all define `:focus-visible` styles with `outline: none` paired with a visible box-shadow/border/background change — i.e. focus is redirected to a custom indicator rather than removed outright.
- `prefers-reduced-motion: reduce` is explicitly honored in `styles.css` for card fade-in, scroll-reveal, bar-fill, hover transforms, chart-reveal, and page transitions (`packages/web/src/styles.css:408-417,1323-1328,1363-1374`), and gates the PBLA WebGL canvas mount entirely via `shouldMountWebGL()`.
- Color contrast: light-mode accent `#1d4ed8` on white and dark-mode accent `#60a5fa` on `#0b0d10` are both comfortably WCAG-AA for normal text. PBLA's gold accent `#ffd166` on its near-black panel backgrounds is high-contrast; however, several PBLA text tokens use `color-mix(in srgb, var(--pbla-white) NN%, transparent)` down to 50–58% opacity for secondary/muted text (e.g. `.pbla-goalie-pill__team`, `.pbla-team-stat__label`), which is worth spot-checking against WCAG AA at small sizes.
- Tab/keyboard: hash-router driven SPA — no explicit route-change focus management (e.g. moving focus to the new view's `<h1>`) was found in `main.ts`/`router.ts`; this applies to both the main site and PBLA.

## Known Inconsistencies / Design Debt
- **PBLA is a fully separate dark-only design system layered on the same shell.** It does not use any of the main site's CSS custom properties (`--bg`, `--fg`, `--accent`, etc.), defines its own token set (`--pbla-*`) scoped to `.pbla-view-root`, and ignores the site's light/dark mode entirely — a user in light mode sees a hard cut to a dark, glassy, gold-accented page when navigating to Box Lacrosse. This is a deliberate "premium partnership pitch page" choice per the CSS comments and route metadata, but it means there are effectively two design systems in one repo with no shared tokens between them.
- **Reduced-motion is now covered in both CSS files.** `tokens.css` has the mandatory global reduce block; `pbla.css` also sets `animation: none` / `transition: none` on `.pbla-view-root` / `.pbla-team-root` including pseudos. WebGL still gates on `shouldMountWebGL()`.
- **PWA manifest colors now match light-mode tokens** (`#1d4ed8` / `#ffffff`). Dark-mode splash still uses the light pair (no runtime theme-color swap).
- **Two different table rendering strategies.** The main site uses native HTML `<table>` markup throughout; PBLA's standings/leaders tables use CSS Grid on `<thead>`/`<tbody>` rows to fake table layout (`pbla-data-table`), which changes how screen readers and the responsive column-hiding rules need to be reasoned about compared to the main site's `.col-secondary` approach.
- **Radius and elevation conventions diverge sharply.** Main site: `4–8px` radii, minimal single-layer shadows, no blur. PBLA: `14–20px` radii, multi-layer shadows, `backdrop-filter: blur()`. There is no shared "elevation" or "radius" token either site draws from — every value is a literal per-component.
- **Shared `--ds-*` tokens live in `packages/web/src/styles/tokens.css`.** Main-site `styles.css` consumes them via `--bg` aliases. PBLA is extracted to `pbla.css` / `pbla-team.css` and remaps `--ds-*` on `.pbla-view-root` / `.pbla-team-root`. Glass/glow washes use `color-mix()` against those tokens. `check-ds-tokens.sh` gates all CSS under `packages/web/src`.
- **`--pbla-muted` (`#94a3b8`) is declared but barely used** compared to the more common inline `color-mix(in srgb, var(--pbla-white) NN%, transparent)` pattern for secondary text — two competing ways to express "muted text" within the same PBLA stylesheet.

## Source Files
Bullet list of the actual files that define the design (global CSS, tailwind config, theme tokens, base layout), with repo-relative paths.

**Main site**
- `packages/web/src/styles.css` — global stylesheet: color tokens (`:root` + dark-mode media query), typography, layout, all shared component styles, motion/animation keyframes.
- `packages/web/src/styles/responsive.css` — supplementary mobile-first responsive utility overrides.
- `packages/web/index.html` — document shell, PWA meta tags (`theme-color`), font stack entry point (no external font links).
- `packages/web/public/manifest.json` — PWA manifest (icons, `theme_color`, `background_color`).
- `packages/web/src/main.ts` — app shell: header/nav construction, route-to-view wiring, page-transition class toggling.
- `packages/web/src/router.ts` — hash-based client-side router and route table (defines the `pbla`/`pblaTeam` routes).
- `packages/web/src/util/motionPrefs.ts` — `shouldAnimate()` / `shouldMountWebGL()` / `isLowPowerDevice()` helpers gating motion across both site areas.
- `packages/web/src/components/*.ts` — reusable UI components (`teamBadge.ts`, `piaaBadge.ts`, `searchBox.ts`, `navGlow.ts`, `hypeCard.ts`, `animatedCounter.ts`, etc.).
- `packages/web/src/charts/*.ts` — D3-based inline SVG chart renderers and their inline styling.

**Box Lacrosse (PBLA) sub-site**
- `packages/web/src/views/pblaStyles.ts` — the entire PBLA-scoped stylesheet, injected at runtime via `ensureStyles()`; defines the `--pbla-*` tokens and every `.pbla-*` component class.
- `packages/web/src/views/pbla.ts` — PBLA league-overview view: render/destroy lifecycle, season switching, live-badge polling.
- `packages/web/src/views/pblaTeam.ts` — PBLA per-team detail view.
- `packages/web/src/views/pblaSections.ts` — builders for hero/season/standings/leaders/games DOM sections.
- `packages/web/src/views/pblaHelpers.ts` — live-badge and misc PBLA view helpers.
- `packages/web/src/views/pblaData.ts` — static PBLA season/team/game/player data.
- `packages/web/src/views/pblaWebGL.ts` — Pixi.js WebGL particle-network background (`PARTICLE_COLORS`), render-token lifecycle, mount/destroy.
- `packages/web/src/components/particleBurst.ts` — click-triggered particle burst effect used within the PBLA WebGL canvas.
