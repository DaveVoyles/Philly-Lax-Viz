import { Application, Graphics } from 'pixi.js';

import { createAnimatedCounter } from '../components/animatedCounter.js';
import { shouldAnimate, shouldMountWebGL } from '../util/motionPrefs.js';
import { setPageMeta } from '../util/pageMeta.js';
import { getPblaSeason, PBLA_DEFAULT_SEASON, SEASONS, teamColor, teamPalette, teamSlug, type PblaGame, type PblaPlayer, type PblaSeason, type PblaTeam } from './pblaData.js';

const STYLE_ID = 'pbla-view-styles';
const PARTICLE_COUNT = 64;
const CONNECT_DISTANCE = 148;
const CONNECT_DISTANCE_SQ = CONNECT_DISTANCE * CONNECT_DISTANCE;
const PARTICLE_COLORS = [0xf68c1f, 0xffd166, 0xf8fafc] as const;
const LIVE_TIMEZONE = 'America/New_York';
const LIVE_MONTH_START = 5;
const LIVE_MONTH_END = 8;
const LIVE_START_MINUTES = 19 * 60;
const LIVE_END_MINUTES = 21 * 60 + 30;
const LIVE_GAME_DAYS = new Set(['Mon', 'Wed']);
const LIVE_STATUS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: LIVE_TIMEZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const LIVE_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: LIVE_TIMEZONE,
  weekday: 'short',
  month: 'numeric',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false,
});
const GAME_CARD_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'numeric',
  day: 'numeric',
  timeZone: 'UTC',
});

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: number;
}

interface BurstShard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: number;
  radius: number;
}

interface BurstRing {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  color: number;
  rotation: number;
}

let renderToken = 0;
let activeApp: Application | null = null;
let activeHost: HTMLElement | null = null;
let activeRoot: HTMLElement | null = null;
let pendingTimers: number[] = [];
let activeBurst: ((x: number, y: number, color: number) => void) | null = null;
let cleanupFns: Array<() => void> = [];

const TEAM_ABBREV: Record<string, string> = {
  'More Dudes LC': 'MDLC',
  'Outlaws': 'Out',
  'Edge': 'Edge',
  'Thunder': 'Thd',
  'Beer Wolves': 'BW',
  'Pups LC': 'PLC',
  'Revolution': 'Rev',
};
function teamAbbrev(team: string): string {
  return TEAM_ABBREV[team] ?? team.slice(0, 4).toUpperCase();
}

type SortDirection = 'asc' | 'desc';
type TeamSortKey = 'rank' | 'name' | 'gp' | 'wins' | 'losses' | 'pts' | 'pf' | 'pa' | 'diff';
type PlayerSortKey = 'name' | 'team' | 'gp' | 'goals' | 'assists' | 'points' | 'pim';

interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

interface SortHeader<K extends string> {
  key: K;
  label: string;
}

function ensureStyles(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;

  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .pbla-view-root {
      --pbla-accent: #ffd166;
      --pbla-white: #f8fafc;
      --pbla-muted: #94a3b8;
      --pbla-ink: #05070d;
      --pbla-panel: rgba(9, 13, 24, 0.84);
      --pbla-panel-strong: rgba(9, 13, 24, 0.94);
      --pbla-border: rgba(255, 209, 102, 0.14);
      position: relative;
      isolation: isolate;
      padding-bottom: 1.25rem;
    }
    .pbla-webgl {
      position: absolute;
      inset: 0;
      z-index: -1;
      pointer-events: none;
      overflow: hidden;
    }
    .pbla-shell {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }
    .pbla-panel {
      position: relative;
      overflow: hidden;
      border-radius: 20px;
      border: 1px solid var(--pbla-border);
      background:
        linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0)),
        var(--pbla-panel);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.05),
        0 24px 60px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(18px);
    }
    .pbla-panel::after {
      content: '';
      position: absolute;
      inset: auto -10% -32% auto;
      width: 220px;
      height: 220px;
      border-radius: 999px;
      background: radial-gradient(circle, rgba(246, 140, 31, 0.18), transparent 72%);
      pointer-events: none;
    }
    .pbla-hero {
      padding: 1.3rem;
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.9fr);
      gap: 1rem;
      align-items: stretch;
    }
    .pbla-hero__copy {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      min-width: 0;
    }
    .pbla-kicker {
      display: inline-flex;
      align-items: center;
      gap: 0.55rem;
      width: fit-content;
      max-width: 100%;
      padding: 0.45rem 0.8rem;
      border-radius: 999px;
      border: 1px solid rgba(246, 140, 31, 0.32);
      background: rgba(246, 140, 31, 0.12);
      color: var(--pbla-accent);
      font-size: 0.74rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .pbla-kicker__dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 999px;
      background: var(--pbla-accent);
      box-shadow: 0 0 16px rgba(246, 140, 31, 0.8);
      animation: pbla-pulse 1.9s ease-in-out infinite;
    }
    .pbla-hero__title {
      margin: 0;
      font-size: clamp(2.2rem, 4vw, 4rem);
      line-height: 0.94;
      letter-spacing: -0.04em;
      color: var(--pbla-white);
    }
    .pbla-hero__title-accent {
      display: block;
      margin-top: 0.2rem;
      background: linear-gradient(135deg, var(--pbla-accent), var(--pbla-accent), var(--pbla-white));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .pbla-hero__subtitle {
      margin: 0;
      max-width: 58ch;
      color: color-mix(in srgb, var(--pbla-white) 72%, transparent);
      font-size: 1rem;
      line-height: 1.65;
    }
    .pbla-hero__chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem;
    }
    .pbla-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.5rem 0.8rem;
      border-radius: 999px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
      color: color-mix(in srgb, var(--pbla-white) 78%, transparent);
      font-size: 0.82rem;
      font-weight: 700;
    }
    .pbla-live-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      width: fit-content;
      max-width: 100%;
      padding: 0.5rem 1rem;
      border-radius: 999px;
      background: rgba(255, 0, 0, 0.08);
      border: 1px solid rgba(255, 0, 0, 0.25);
      color: var(--pbla-white);
      text-decoration: none;
      transition: transform 200ms ease, background 200ms ease, border-color 200ms ease, box-shadow 200ms ease;
    }
    .pbla-live-badge:hover,
    .pbla-live-badge:focus-visible {
      transform: translateY(-1px);
      border-color: rgba(255, 0, 0, 0.42);
      outline: none;
    }
    .pbla-live-badge--active {
      background: rgba(255, 0, 0, 0.15);
      border-color: rgba(255, 0, 0, 0.5);
      box-shadow: 0 0 20px rgba(255, 0, 0, 0.3);
    }
    .pbla-live-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1rem;
      height: 1rem;
      color: #ff4444;
      flex: 0 0 auto;
    }
    .pbla-live-icon svg {
      width: 100%;
      height: 100%;
      fill: currentColor;
    }
    .pbla-live-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #666;
      flex: 0 0 auto;
    }
    .pbla-live-badge--active .pbla-live-dot {
      background: #ff0000;
      animation: pbla-live-pulse 1.5s ease-in-out infinite;
      box-shadow: 0 0 8px rgba(255, 0, 0, 0.6);
    }
    .pbla-live-text {
      font-size: 0.82rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      line-height: 1.1;
    }
    .pbla-live-badge--active .pbla-live-text {
      color: #ff4444;
    }
    .pbla-hero__side {
      display: grid;
      gap: 0.95rem;
      min-width: 0;
    }
    .pbla-side-card {
      position: relative;
      overflow: hidden;
      border-radius: 18px;
      border: 1px solid rgba(255, 209, 102, 0.18);
      background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0)), rgba(5, 7, 13, 0.68);
      padding: 1rem;
    }
    .pbla-side-card__eyebrow {
      margin: 0 0 0.35rem;
      color: var(--pbla-accent);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .pbla-side-card__title {
      margin: 0;
      color: var(--pbla-white);
      font-size: 1rem;
      font-weight: 800;
    }
    .pbla-side-card__text {
      margin: 0.4rem 0 0;
      color: color-mix(in srgb, var(--pbla-white) 70%, transparent);
      font-size: 0.88rem;
      line-height: 1.55;
    }
    .pbla-goalie-lane {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.6rem;
      margin-top: 0.9rem;
    }
    .pbla-goalie-pill {
      padding: 0.7rem 0.45rem;
      border-radius: 14px;
      border: 1px dashed rgba(255, 209, 102, 0.22);
      background: rgba(255,255,255,0.03);
      text-align: center;
    }
    .pbla-goalie-pill__value {
      display: block;
      color: var(--pbla-white);
      font-size: 0.95rem;
      font-weight: 800;
    }
    .pbla-goalie-pill__label {
      display: block;
      margin-top: 0.15rem;
      color: color-mix(in srgb, var(--pbla-white) 64%, transparent);
      font-size: 0.72rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .pbla-goalie-pill__team {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.25rem;
      margin-top: 0.25rem;
      font-size: 0.62rem;
      letter-spacing: 0.04em;
      color: color-mix(in srgb, var(--pbla-white) 50%, transparent);
    }
    .pbla-goalie-pill__dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: var(--team-color, #888);
      flex-shrink: 0;
    }
    .pbla-season-bar {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 0.55rem;
      padding: 0.32rem;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.03);
      width: fit-content;
    }
    .pbla-season-btn {
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: color-mix(in srgb, var(--pbla-white) 62%, transparent);
      padding: 0.55rem 0.95rem;
      font: inherit;
      font-size: 0.84rem;
      font-weight: 700;
      cursor: pointer;
      transition: transform 180ms ease, background 180ms ease, color 180ms ease, box-shadow 180ms ease;
    }
    .pbla-season-btn:hover {
      transform: translateY(-1px);
      color: var(--pbla-white);
    }
    .pbla-season-btn.is-active {
      background: linear-gradient(135deg, rgba(246, 140, 31, 0.22), rgba(255, 209, 102, 0.18));
      color: var(--pbla-white);
      box-shadow: 0 0 0 1px rgba(255, 209, 102, 0.18) inset;
    }
    .pbla-season-summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.85rem;
      padding: 0 0.2rem;
    }
    .pbla-summary-card {
      position: relative;
      padding: 1rem;
      border-radius: 18px;
      border: 1px solid rgba(255, 209, 102, 0.22);
      background: rgba(255,255,255,0.03);
      min-width: 0;
      overflow: hidden;
      animation: cardGlow 3s ease-in-out infinite alternate;
    }
    .pbla-summary-card:nth-child(2) { animation-delay: 0.75s; }
    .pbla-summary-card:nth-child(3) { animation-delay: 1.5s; }
    .pbla-summary-card:nth-child(4) { animation-delay: 2.25s; }
    .pbla-summary-card::before {
      content: '';
      position: absolute;
      inset: -1px;
      border-radius: 18px;
      padding: 1px;
      background: linear-gradient(135deg, rgba(246, 140, 31, 0.5), rgba(255, 209, 102, 0.2), rgba(246, 140, 31, 0.5));
      background-size: 200% 200%;
      animation: shimmerBorder 4s linear infinite;
      -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
    }
    .pbla-summary-card::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 18px;
      background: radial-gradient(ellipse at 50% 0%, rgba(246, 140, 31, 0.12), transparent 70%);
      pointer-events: none;
    }
    @keyframes cardGlow {
      0% { box-shadow: 0 0 8px rgba(246, 140, 31, 0.15), inset 0 0 12px rgba(246, 140, 31, 0.05); }
      100% { box-shadow: 0 0 20px rgba(246, 140, 31, 0.3), inset 0 0 20px rgba(246, 140, 31, 0.08); }
    }
    @keyframes shimmerBorder {
      0% { background-position: 0% 50%; }
      100% { background-position: 200% 50%; }
    }
    .pbla-summary-card__label {
      display: block;
      position: relative;
      z-index: 1;
      margin-bottom: 0.4rem;
      color: color-mix(in srgb, var(--pbla-white) 64%, transparent);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .pbla-summary-card__value {
      display: block;
      position: relative;
      z-index: 1;
      color: var(--pbla-white);
      font-size: clamp(1.55rem, 2vw, 2.2rem);
      font-weight: 900;
      line-height: 1;
    }
    .pbla-summary-card__note {
      display: block;
      position: relative;
      z-index: 1;
      margin-top: 0.35rem;
      color: color-mix(in srgb, var(--pbla-white) 58%, transparent);
      font-size: 0.78rem;
      line-height: 1.4;
    }
    .pbla-section {
      padding: 1.1rem;
    }
    .pbla-section__header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
      flex-wrap: wrap;
    }
    .pbla-section__eyebrow {
      display: block;
      margin-bottom: 0.3rem;
      color: var(--pbla-accent);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .pbla-section__title {
      margin: 0;
      color: var(--pbla-white);
      font-size: clamp(1.3rem, 2vw, 1.8rem);
      font-weight: 900;
      letter-spacing: -0.03em;
    }
    .pbla-section__subtitle {
      margin: 0.3rem 0 0;
      color: color-mix(in srgb, var(--pbla-white) 66%, transparent);
      font-size: 0.9rem;
      line-height: 1.55;
      max-width: 62ch;
    }
    .pbla-section__meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      color: color-mix(in srgb, var(--pbla-white) 60%, transparent);
      font-size: 0.82rem;
      font-weight: 700;
    }
    .pbla-meta-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.35rem 0.7rem;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 800;
      letter-spacing: 0.02em;
    }
    .pbla-meta-badge--gold {
      background: rgba(255, 209, 102, 0.15);
      border: 1px solid rgba(255, 209, 102, 0.35);
      color: var(--pbla-accent);
    }
    .pbla-meta-badge--fire {
      background: rgba(255, 209, 102, 0.12);
      border: 1px solid rgba(255, 209, 102, 0.30);
      color: var(--pbla-accent);
    }
    .pbla-standings-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.7rem;
    }
    .pbla-table-stack {
      display: grid;
      gap: 0.75rem;
      margin-top: 0.75rem;
    }
    .pbla-table-note {
      margin: 0;
      color: color-mix(in srgb, var(--pbla-white) 62%, transparent);
      font-size: 0.82rem;
      line-height: 1.5;
    }
    .pbla-team-card {
      position: relative;
      overflow: hidden;
      display: grid;
      gap: 0.45rem;
      padding: 0.65rem 0.9rem;
      border-radius: 16px;
      border: 1px solid color-mix(in srgb, var(--team-color) 30%, transparent);
      background: linear-gradient(135deg, color-mix(in srgb, var(--team-color) 8%, transparent), color-mix(in srgb, var(--team-secondary) 5%, transparent)), rgba(6, 10, 18, 0.92);
      text-decoration: none;
      color: inherit;
      box-shadow: inset 0 1px 0 color-mix(in srgb, var(--team-secondary) 12%, transparent);
      transition: transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 280ms ease, border-color 280ms ease;
      opacity: 0;
      transform: translateY(18px) scale(0.985);
    }
    .pbla-team-card::before {
      content: '';
      position: absolute;
      inset: auto -8% -38% auto;
      width: 180px;
      height: 180px;
      border-radius: 999px;
      background: radial-gradient(circle, color-mix(in srgb, var(--team-color) 20%, transparent), transparent 72%);
      pointer-events: none;
      opacity: 0.95;
    }
    .pbla-team-card::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(
        105deg,
        transparent 40%,
        rgba(255,255,255,0.06) 45%,
        rgba(255,255,255,0.12) 50%,
        rgba(255,255,255,0.06) 55%,
        transparent 60%
      );
      transform: translateX(-100%);
      transition: transform 600ms ease;
      pointer-events: none;
      border-radius: inherit;
    }
    .pbla-team-card:hover,
    .pbla-team-card:focus-visible {
      transform: scale(1.02) translateY(-2px);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.04),
        0 8px 32px rgba(0,0,0,0.3),
        0 0 0 1px color-mix(in srgb, var(--team-color) 36%, transparent),
        0 16px 36px color-mix(in srgb, var(--team-color) 18%, transparent);
      border-color: color-mix(in srgb, var(--team-color) 40%, transparent);
      outline: none;
    }
    .pbla-team-card:hover::after,
    .pbla-team-card:focus-visible::after {
      transform: translateX(100%);
    }
    .pbla-team-card.is-visible {
      opacity: 1;
      transform: translateY(0) scale(1);
      transition: transform 560ms cubic-bezier(0.22, 1, 0.36, 1), opacity 560ms ease;
      transition-delay: var(--delay, 0ms);
    }
    .pbla-team-card__top {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 0.8rem;
    }
    .pbla-rank-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 2.4rem;
      height: 2.4rem;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--team-color) 44%, transparent);
      background: color-mix(in srgb, var(--team-color) 16%, transparent);
      color: var(--team-color);
      font-size: 0.8rem;
      font-weight: 900;
      letter-spacing: 0.04em;
      position: relative;
      z-index: 1;
    }
    .pbla-team-card__identity {
      min-width: 0;
      flex: 1;
      position: relative;
      z-index: 1;
    }
    .pbla-team-card__headline {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      min-width: 0;
    }
    .pbla-team-card__swatch {
      flex: 0 0 auto;
      width: 0.8rem;
      height: 0.8rem;
      border-radius: 999px;
      background: var(--team-color);
      box-shadow: 0 0 18px color-mix(in srgb, var(--team-color) 42%, transparent);
      transition: transform 220ms ease, box-shadow 220ms ease;
    }
    .pbla-team-card:hover .pbla-team-card__swatch,
    .pbla-team-card:focus-visible .pbla-team-card__swatch {
      transform: scale(1.22);
      box-shadow: 0 0 22px color-mix(in srgb, var(--team-color) 60%, transparent);
    }
    .pbla-team-card__swatch.is-pulsing {
      animation: pbla-team-swatch-pulse 460ms ease;
    }
    .pbla-team-card__name {
      margin: 0;
      color: var(--pbla-white);
      font-size: 0.95rem;
      font-weight: 900;
      letter-spacing: -0.02em;
      min-width: 0;
    }
    .pbla-team-card__record {
      margin-top: 0.15rem;
      color: color-mix(in srgb, var(--pbla-white) 68%, transparent);
      font-size: 0.8rem;
      line-height: 1.35;
    }
    .pbla-streak {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.35rem 0.55rem;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      white-space: nowrap;
      position: relative;
      z-index: 1;
    }
    .pbla-streak--win {
      color: #86efac;
      border: 1px solid rgba(134, 239, 172, 0.18);
      background: rgba(34, 197, 94, 0.11);
    }
    .pbla-streak--loss {
      color: #fca5a5;
      border: 1px solid rgba(252, 165, 165, 0.18);
      background: rgba(239, 68, 68, 0.11);
    }
    .pbla-team-card__stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.4rem;
      position: relative;
      z-index: 1;
    }
    .pbla-team-stat {
      padding: 0.45rem 0.5rem;
      border-radius: 10px;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.05);
      transition: background 220ms ease, border-color 220ms ease;
    }
    .pbla-team-card:hover .pbla-team-stat,
    .pbla-team-card:focus-visible .pbla-team-stat {
      background: color-mix(in srgb, var(--team-color) 10%, rgba(255,255,255,0.03));
      border-color: color-mix(in srgb, var(--team-color) 22%, rgba(255,255,255,0.05));
    }
    .pbla-team-stat__label {
      display: block;
      color: color-mix(in srgb, var(--pbla-white) 58%, transparent);
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }
    .pbla-team-stat__value {
      display: block;
      margin-top: 0.35rem;
      color: var(--pbla-white);
      font-size: 1.18rem;
      font-weight: 900;
      line-height: 1;
    }
    .pbla-team-card__win {
      display: grid;
      gap: 0.45rem;
      position: relative;
      z-index: 1;
    }
    .pbla-team-card__win-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      color: color-mix(in srgb, var(--pbla-white) 64%, transparent);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .pbla-win-track {
      height: 3px;
      border-radius: 999px;
      background: rgba(255,255,255,0.08);
      overflow: hidden;
    }
    .pbla-win-bar {
      height: 3px;
      border-radius: 2px;
      background: var(--team-color);
      transform-origin: left;
      transform: scaleX(0);
      transition: transform 800ms cubic-bezier(0.16, 1, 0.3, 1);
      opacity: 0.7;
    }
    .pbla-win-bar.is-visible {
      transform: scaleX(var(--win-pct));
    }
    .pbla-table-shell {
      overflow-x: auto;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.06);
      background: rgba(255,255,255,0.02);
    }
    .pbla-data-table {
      width: 100%;
      min-width: 760px;
      border-collapse: separate;
      border-spacing: 0;
    }
    .pbla-data-table thead,
    .pbla-data-table tbody {
      display: block;
    }
    .pbla-data-table thead tr,
    .pbla-data-table tbody tr {
      display: grid;
      width: 100%;
      align-items: center;
    }
    .pbla-standings-table thead tr,
    .pbla-standings-table tbody tr {
      grid-template-columns: 4.5rem minmax(12rem, 1.8fr) repeat(7, minmax(4.5rem, 0.72fr));
    }
    .pbla-leaders-table thead tr,
    .pbla-leaders-table tbody tr {
      grid-template-columns: 4.5rem minmax(15rem, 1.9fr) minmax(10rem, 1.25fr) repeat(5, minmax(4rem, 0.7fr));
    }
    .pbla-data-table th,
    .pbla-data-table td {
      padding: 0.85rem 0.8rem;
      text-align: left;
      color: color-mix(in srgb, var(--pbla-white) 82%, transparent);
      font-size: 0.89rem;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      position: relative;
      z-index: 1;
    }
    .pbla-data-table th {
      color: color-mix(in srgb, var(--pbla-white) 58%, transparent);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.03);
    }
    .pbla-standings-table th:nth-child(n + 3),
    .pbla-standings-table td:nth-child(n + 3),
    .pbla-leaders-table th:nth-child(n + 4),
    .pbla-leaders-table td:nth-child(n + 4) {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .pbla-sort-header {
      cursor: pointer;
      user-select: none;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      opacity: 0.7;
      transition: opacity 150ms;
      border: 0;
      background: transparent;
      padding: 0;
      color: inherit;
      font: inherit;
      text-transform: inherit;
      letter-spacing: inherit;
    }
    .pbla-sort-header:hover,
    .pbla-sort-header:focus-visible,
    .pbla-sort-header--active {
      opacity: 1;
      outline: none;
    }
    .pbla-sort-arrow {
      font-size: 0.7em;
      transition: transform 200ms, opacity 150ms;
      opacity: 0;
    }
    .pbla-sort-header--active .pbla-sort-arrow {
      opacity: 1;
    }
    .pbla-sort-arrow--desc {
      transform: rotate(180deg);
    }
    .pbla-standings-row,
    .pbla-leaders-row {
      position: relative;
      overflow: hidden;
      opacity: 0;
      border-left: 3px solid color-mix(in srgb, var(--team-color) 70%, transparent);
      background: linear-gradient(90deg, color-mix(in srgb, var(--team-color) 6%, transparent), transparent 60%);
    }
    .pbla-standings-row {
      transform: translateY(12px);
    }
    .pbla-leaders-row {
      transform: translateX(-12px);
    }
    .pbla-standings-row.is-visible,
    .pbla-leaders-row.is-visible {
      opacity: 1;
      transition: transform 520ms cubic-bezier(0.22, 1, 0.36, 1), opacity 520ms ease;
      transition-delay: var(--delay, 0ms);
    }
    .pbla-standings-row.is-visible {
      transform: translateY(0);
    }
    .pbla-leaders-row.is-visible {
      transform: translateX(0);
    }
    .pbla-standings-row:hover,
    .pbla-standings-row:focus-within,
    .pbla-leaders-row:hover,
    .pbla-leaders-row:focus-within {
      background: linear-gradient(90deg, color-mix(in srgb, var(--team-color) 14%, transparent), transparent 75%);
    }
    .pbla-points-bar {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      background: var(--team-color);
      opacity: 0.10;
      border-radius: 0.4rem;
      transform-origin: left;
      transform: scaleX(0);
      transition: transform 600ms cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: none;
      z-index: 0;
    }
    .pbla-points-bar.is-visible {
      transform: scaleX(var(--pts-pct));
    }
    .pbla-rank-cell {
      width: 3rem;
      color: var(--pbla-accent);
      font-weight: 900;
      white-space: nowrap;
    }
    .pbla-rank-fire {
      margin-left: 0.3rem;
      filter: drop-shadow(0 0 10px rgba(246, 140, 31, 0.55));
    }
    .pbla-player-cell,
    .pbla-team-name-cell {
      min-width: 190px;
    }
    .pbla-player-cell__name,
    .pbla-team-name-cell__name {
      display: block;
      color: var(--pbla-white);
      font-weight: 800;
    }
    .pbla-player-cell__jersey {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 2.35rem;
      height: 1.45rem;
      margin-right: 0.55rem;
      border-radius: 999px;
      background: rgba(246, 140, 31, 0.12);
      border: 1px solid rgba(246, 140, 31, 0.24);
      color: var(--pbla-accent);
      font-size: 0.72rem;
      font-weight: 800;
    }
    .pbla-team-cell,
    .pbla-team-name-cell__sub {
      color: color-mix(in srgb, var(--pbla-white) 66%, transparent);
      font-weight: 700;
    }
    .pbla-team-name-cell__sub {
      display: block;
      margin-top: 0.22rem;
      font-size: 0.82rem;
      font-weight: 600;
      line-height: 1.45;
    }
    .pbla-team-swatch {
      display: inline-block;
      width: 0.65rem;
      height: 0.65rem;
      margin-right: 0.45rem;
      border-radius: 999px;
      vertical-align: middle;
      box-shadow: 0 0 12px color-mix(in srgb, var(--swatch-color) 44%, transparent);
      background: var(--swatch-color);
    }
    .pbla-points-cell {
      color: var(--pbla-accent);
      font-weight: 900;
    }
    .pbla-games-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.85rem;
    }
    .pbla-game-card {
      display: grid;
      gap: 0.45rem;
      padding: 0.7rem 1rem;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.08);
      background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0)), rgba(6, 10, 18, 0.9);
      opacity: 0;
      transform: translateY(14px);
    }
    .pbla-game-card.is-visible {
      opacity: 1;
      transform: translateY(0);
      transition: transform 480ms cubic-bezier(0.22, 1, 0.36, 1), opacity 480ms ease;
      transition-delay: var(--delay, 0ms);
    }
    .pbla-game-card--playoff {
      border-color: rgba(255, 209, 102, 0.24);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 16px 32px rgba(255, 209, 102, 0.08);
    }
    .pbla-game-card__top {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .pbla-game-card__date {
      color: var(--pbla-accent);
      font-size: 0.82rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .pbla-game-card__badges {
      display: inline-flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 0.45rem;
    }
    .pbla-game-card__badge {
      display: inline-flex;
      align-items: center;
      padding: 0.35rem 0.6rem;
      border-radius: 999px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
      color: color-mix(in srgb, var(--pbla-white) 86%, transparent);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .pbla-game-card__badge--playoff {
      background: rgba(255, 209, 102, 0.12);
      border-color: rgba(255, 209, 102, 0.28);
      color: var(--pbla-accent);
    }
    .pbla-game-card__badge--note {
      color: color-mix(in srgb, var(--pbla-white) 72%, transparent);
    }
    .pbla-game-card__matchup {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.45rem;
      color: color-mix(in srgb, var(--pbla-white) 82%, transparent);
      font-size: 1rem;
      line-height: 1.45;
    }
    .pbla-game-card__team {
      font-weight: 700;
    }
    .pbla-game-card__team--winner {
      color: var(--pbla-white);
      font-weight: 900;
    }
    .pbla-game-card__vs {
      color: color-mix(in srgb, var(--pbla-white) 52%, transparent);
      font-size: 0.76rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .pbla-games-toggle {
      margin-top: 1rem;
      border: 1px solid rgba(255, 209, 102, 0.2);
      border-radius: 999px;
      background: rgba(255,255,255,0.04);
      color: var(--pbla-white);
      padding: 0.72rem 1rem;
      font: inherit;
      font-size: 0.84rem;
      font-weight: 800;
      cursor: pointer;
      transition: transform 180ms ease, background 180ms ease, border-color 180ms ease;
    }
    .pbla-games-toggle:hover,
    .pbla-games-toggle:focus-visible {
      transform: translateY(-1px);
      background: rgba(246, 140, 31, 0.12);
      border-color: rgba(246, 140, 31, 0.34);
      outline: none;
    }
    .pbla-games-empty {
      padding: 1rem;
      border-radius: 18px;
      border: 1px dashed rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.03);
      color: color-mix(in srgb, var(--pbla-white) 68%, transparent);
      line-height: 1.6;
    }
    .pbla-cta {
      padding: 1.45rem;
      text-align: center;
      background:
        linear-gradient(135deg, rgba(246, 140, 31, 0.12), rgba(255, 209, 102, 0.08)),
        rgba(9, 13, 24, 0.88);
    }
    .pbla-cta__title {
      margin: 0;
      color: var(--pbla-white);
      font-size: clamp(1.35rem, 2vw, 2rem);
      font-weight: 900;
      letter-spacing: -0.03em;
    }
    .pbla-cta__text {
      margin: 0.55rem auto 0;
      max-width: 58ch;
      color: color-mix(in srgb, var(--pbla-white) 68%, transparent);
      font-size: 0.96rem;
      line-height: 1.6;
    }
    .pbla-cta__links {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 0.8rem;
      margin-top: 1.1rem;
    }
    .pbla-cta__link {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.72rem 1rem;
      border-radius: 999px;
      border: 1px solid rgba(255, 209, 102, 0.22);
      background: rgba(255,255,255,0.04);
      color: var(--pbla-white);
      font-size: 0.86rem;
      font-weight: 800;
      text-decoration: none;
      transition: transform 180ms ease, background 180ms ease, border-color 180ms ease;
    }
    .pbla-cta__link:hover,
    .pbla-cta__link:focus-visible {
      transform: translateY(-2px);
      background: rgba(246, 140, 31, 0.12);
      border-color: rgba(246, 140, 31, 0.34);
      outline: none;
    }
    @keyframes pbla-pulse {
      0%, 100% { transform: scale(1); opacity: 0.8; }
      50% { transform: scale(1.15); opacity: 1; }
    }
    @keyframes pbla-team-swatch-pulse {
      0% { transform: scale(1); }
      45% { transform: scale(1.35); }
      100% { transform: scale(1); }
    }
    @keyframes pbla-live-pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.3); opacity: 0.7; }
    }
    @media (max-width: 1040px) {
      .pbla-hero,
      .pbla-season-summary,
      .pbla-standings-grid,
      .pbla-games-grid {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 720px) {
      .pbla-hero,
      .pbla-section,
      .pbla-cta {
        padding: 0.85rem;
      }
      .pbla-goalie-lane,
      .pbla-team-card__stats {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .pbla-hero__title {
        font-size: clamp(1.9rem, 10vw, 2.8rem);
      }
    }
    @media (max-width: 520px) {
      .pbla-season-bar {
        width: 100%;
        justify-content: center;
      }
      .pbla-season-btn {
        flex: 1 1 0;
      }
      .pbla-goalie-lane,
      .pbla-team-card__stats {
        grid-template-columns: 1fr 1fr;
      }
    }
  `;
  doc.head.appendChild(style);
}

function schedule(callback: () => void, delay: number): void {
  const timer = window.setTimeout(() => {
    pendingTimers = pendingTimers.filter((value) => value !== timer);
    callback();
  }, delay);
  pendingTimers.push(timer);
}

function clearPendingTimers(): void {
  for (const timer of pendingTimers) window.clearTimeout(timer);
  pendingTimers = [];
}

function clearCleanup(): void {
  for (const fn of cleanupFns) fn();
  cleanupFns = [];
}

function clearScopedCleanup(cleanups: Array<() => void>): void {
  while (cleanups.length) {
    const cleanup = cleanups.pop();
    cleanup?.();
  }
}

function destroyWebGL(): void {
  activeBurst = null;
  if (activeApp) {
    activeApp.destroy(true, { children: true, texture: true });
    activeApp = null;
  }
  if (activeHost) {
    activeHost.replaceChildren();
    activeHost = null;
  }
}

function pickParticleColor(): number {
  const index = Math.floor(Math.random() * PARTICLE_COLORS.length);
  return PARTICLE_COLORS[index] ?? PARTICLE_COLORS[0];
}

function wrap(value: number, max: number): number {
  if (max <= 0) return 0;
  const next = value % max;
  return next < 0 ? next + max : next;
}

function makeParticles(width: number, height: number): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() * 0.24 + 0.04) * (Math.random() > 0.5 ? 1 : -1),
    vy: (Math.random() * 0.18 + 0.03) * (Math.random() > 0.5 ? 1 : -1),
    radius: Math.random() * 2.4 + 1.2,
    color: pickParticleColor(),
  }));
}

function mountWebGL(host: HTMLElement, token: number): void {
  destroyWebGL();
  activeHost = host;
  host.replaceChildren();

  const stage = document.createElement('div');
  stage.style.position = 'absolute';
  stage.style.inset = '0';
  host.appendChild(stage);

  const app = new Application();
  activeApp = app;
  const lineLayer = new Graphics();
  const particleLayer = new Graphics();
  const effectLayer = new Graphics();
  const shards: BurstShard[] = [];
  const rings: BurstRing[] = [];
  let particles: Particle[] = [];
  let lastSize = { width: 0, height: 0 };

  activeBurst = (x: number, y: number, color: number): void => {
    if (token !== renderToken || activeApp !== app) return;
    rings.push({ x, y, life: 28, maxLife: 28, color, rotation: Math.random() * Math.PI * 2 });
    for (let i = 0; i < 10; i += 1) {
      const angle = (Math.PI * 2 * i) / 10 + Math.random() * 0.25;
      const speed = Math.random() * 1.8 + 0.7;
      shards.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 34 + Math.random() * 10,
        maxLife: 34 + Math.random() * 10,
        color,
        radius: Math.random() * 2.2 + 1.2,
      });
    }
  };

  const tick = (): void => {
    if (token !== renderToken || activeApp !== app) return;
    const width = Math.max(app.screen.width, 1);
    const height = Math.max(app.screen.height, 1);
    if (width !== lastSize.width || height !== lastSize.height || particles.length === 0) {
      particles = makeParticles(width, height);
      lastSize = { width, height };
    }

    const delta = app.ticker.deltaTime;
    lineLayer.clear();
    particleLayer.clear();
    effectLayer.clear();

    for (const particle of particles) {
      particle.x = wrap(particle.x + particle.vx * delta, width);
      particle.y = wrap(particle.y + particle.vy * delta, height);
    }

    for (let i = 0; i < particles.length; i += 1) {
      const a = particles[i];
      if (!a) continue;
      for (let j = i + 1; j < particles.length; j += 1) {
        const b = particles[j];
        if (!b) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq > CONNECT_DISTANCE_SQ) continue;
        const alpha = 0.12 * (1 - distanceSq / CONNECT_DISTANCE_SQ);
        lineLayer.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: a.color, alpha });
      }
    }

    for (const particle of particles) {
      particleLayer.circle(particle.x, particle.y, particle.radius).fill({ color: particle.color, alpha: 0.72 });
    }

    for (let i = rings.length - 1; i >= 0; i -= 1) {
      const ring = rings[i];
      if (!ring) continue;
      ring.life -= delta;
      if (ring.life <= 0) {
        rings.splice(i, 1);
        continue;
      }
      const progress = 1 - ring.life / ring.maxLife;
      const radius = 8 + progress * 22;
      const alpha = (1 - progress) * 0.85;
      effectLayer.circle(ring.x, ring.y, radius).stroke({ width: 1.6, color: ring.color, alpha });

      const seam = radius * 0.62;
      const angle = ring.rotation + progress * 1.8;
      const dx = Math.cos(angle) * seam;
      const dy = Math.sin(angle) * seam;
      effectLayer.moveTo(ring.x - dx, ring.y - dy).lineTo(ring.x + dx, ring.y + dy).stroke({ width: 1, color: ring.color, alpha: alpha * 0.72 });
      effectLayer.moveTo(ring.x - dy * 0.6, ring.y + dx * 0.6).lineTo(ring.x + dy * 0.6, ring.y - dx * 0.6).stroke({ width: 1, color: ring.color, alpha: alpha * 0.58 });
    }

    for (let i = shards.length - 1; i >= 0; i -= 1) {
      const shard = shards[i];
      if (!shard) continue;
      shard.life -= delta;
      if (shard.life <= 0) {
        shards.splice(i, 1);
        continue;
      }
      shard.x += shard.vx * delta;
      shard.y += shard.vy * delta;
      effectLayer.circle(shard.x, shard.y, shard.radius).fill({
        color: shard.color,
        alpha: Math.max(shard.life / shard.maxLife, 0) * 0.9,
      });
    }
  };

  void app.init({
    backgroundAlpha: 0,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio ?? 1, 2),
    autoDensity: true,
    resizeTo: stage,
  }).then(() => {
    if (token !== renderToken || activeApp !== app || !document.body.contains(host)) {
      app.destroy(true, { children: true, texture: true });
      if (activeApp === app) activeApp = null;
      return;
    }

    app.stage.addChild(lineLayer);
    app.stage.addChild(particleLayer);
    app.stage.addChild(effectLayer);
    app.canvas.style.display = 'block';
    app.canvas.style.width = '100%';
    app.canvas.style.height = '100%';
    stage.appendChild(app.canvas);
    app.ticker.add(tick);
    tick();
  });
}

function compareTeams(a: PblaTeam, b: PblaTeam): number {
  return b.pts - a.pts || b.diff - a.diff || b.pf - a.pf || a.pa - b.pa || a.name.localeCompare(b.name);
}

function toPixiColor(color: string): number {
  return parseInt(color.replace('#', ''), 16);
}

function formatSigned(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function sumGoalsFor(season: PblaSeason): number {
  return season.teams.reduce((sum, team) => sum + team.pf, 0);
}

function topPoints(season: PblaSeason): number {
  return season.players.reduce((best, player) => Math.max(best, player.points), 0);
}

function defaultSortDirection(key: string): SortDirection {
  return key === 'name' || key === 'team' ? 'asc' : 'desc';
}

function toggleSort<K extends string>(state: SortState<K>, key: K): SortState<K> {
  if (state.key === key) {
    return { key, direction: state.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key, direction: defaultSortDirection(key) };
}

function sortTeams(teams: PblaTeam[], state: SortState<TeamSortKey>): PblaTeam[] {
  return [...teams].sort((a, b) => {
    if (state.key === 'rank') {
      const ranked = compareTeams(a, b);
      return state.direction === 'asc' ? -ranked : ranked;
    }

    let result = 0;
    if (state.key === 'name') {
      result = a.name.localeCompare(b.name);
    } else {
      result = Number(a[state.key]) - Number(b[state.key]);
    }
    if (result === 0) result = compareTeams(a, b);
    return state.direction === 'asc' ? result : -result;
  });
}

function sortPlayers(players: PblaPlayer[], state: SortState<PlayerSortKey>): PblaPlayer[] {
  return [...players].sort((a, b) => {
    let result = 0;
    if (state.key === 'name' || state.key === 'team') {
      result = a[state.key].localeCompare(b[state.key]);
    } else {
      result = Number(a[state.key]) - Number(b[state.key]);
    }
    if (result === 0) result = b.points - a.points || a.name.localeCompare(b.name);
    return state.direction === 'asc' ? result : -result;
  });
}

type EasternDateParts = {
  weekday: string;
  month: number;
  day: number;
  year: number;
  hour: number;
  minute: number;
};

function getEasternDateParts(date: Date = new Date()): EasternDateParts {
  const parts = Object.fromEntries(
    LIVE_PARTS_FORMATTER
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  return {
    weekday: parts.weekday ?? 'Mon',
    month: Number(parts.month ?? '1'),
    day: Number(parts.day ?? '1'),
    year: Number(parts.year ?? '1970'),
    hour: Number(parts.hour ?? '0'),
    minute: Number(parts.minute ?? '0'),
  };
}

function isSeasonMonth(month: number): boolean {
  return month >= LIVE_MONTH_START && month <= LIVE_MONTH_END;
}

function isGameNight(weekday: string): boolean {
  return LIVE_GAME_DAYS.has(weekday);
}

function makeCalendarDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function formatCompactDate(formatter: Intl.DateTimeFormat, date: Date): string {
  return formatter.format(date).replace(',', '');
}

function isLiveNow(date: Date = new Date()): boolean {
  const { weekday, month, hour, minute } = getEasternDateParts(date);
  const minutes = hour * 60 + minute;
  return isSeasonMonth(month) && isGameNight(weekday) && minutes >= LIVE_START_MINUTES && minutes < LIVE_END_MINUTES;
}

function getNextGameDate(date: Date = new Date()): string {
  const current = getEasternDateParts(date);
  const currentMinutes = current.hour * 60 + current.minute;

  // If currently live, show today's date
  if (isSeasonMonth(current.month) && isGameNight(current.weekday) && currentMinutes < LIVE_END_MINUTES) {
    return formatCompactDate(LIVE_STATUS_FORMATTER, date);
  }

  // Use actual schedule dates from the current season
  const season = getPblaSeason(PBLA_DEFAULT_SEASON);
  const nowMs = date.getTime();
  const upcoming = season.games
    .filter((g) => parseGameTimestamp(g) > nowMs)
    .sort((a, b) => parseGameTimestamp(a) - parseGameTimestamp(b));

  if (upcoming.length > 0) {
    const nextTs = parseGameTimestamp(upcoming[0]!);
    return formatCompactDate(LIVE_STATUS_FORMATTER, new Date(nextTs));
  }

  // Fallback: season is over
  return 'TBD';
}

function updateLiveBadge(badge: HTMLAnchorElement, text: HTMLElement): void {
  const live = isLiveNow();
  const nextGame = getNextGameDate();
  badge.classList.toggle('pbla-live-badge--active', live);
  text.textContent = live ? 'LIVE NOW' : `Next game: ${nextGame}`;
  badge.setAttribute('aria-label', live ? 'PBLA is live now on YouTube' : `Next PBLA game ${nextGame} on YouTube`);
}

function parseGameTimestamp(game: PblaGame): number {
  const [rawYear, rawMonth, rawDay] = game.date.split('-').map(Number);
  const year = rawYear ?? 1970;
  const month = rawMonth ?? 1;
  const day = rawDay ?? 1;
  const match = game.time.match(/^(\d{1,2}):(\d{2})([ap])$/i);
  let hour = Number(match?.[1] ?? '0');
  const minute = Number(match?.[2] ?? '0');
  const meridiem = (match?.[3] ?? 'a').toLowerCase();
  if (meridiem === 'p' && hour < 12) hour += 12;
  if (meridiem === 'a' && hour === 12) hour = 0;
  return Date.UTC(year, month - 1, day, hour, minute);
}

function formatGameCardDate(game: PblaGame): string {
  return formatCompactDate(GAME_CARD_DATE_FORMATTER, new Date(parseGameTimestamp(game)));
}

function attachBurstTarget(
  target: HTMLElement,
  host: HTMLElement,
  color: string,
  token: number,
  cleanups: Array<() => void> = cleanupFns,
): void {
  const fire = (): void => {
    if (!activeBurst || token !== renderToken) return;
    const hostRect = host.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    activeBurst(
      rect.left + rect.width / 2 - hostRect.left,
      rect.top + rect.height / 2 - hostRect.top,
      toPixiColor(color),
    );
  };

  target.addEventListener('pointerenter', fire);
  target.addEventListener('focus', fire);
  cleanups.push(() => {
    target.removeEventListener('pointerenter', fire);
    target.removeEventListener('focus', fire);
  });
}

function observeOnEnter(
  element: HTMLElement,
  animate: boolean,
  callback: () => void,
  cleanups: Array<() => void> = cleanupFns,
): void {
  if (!animate || typeof IntersectionObserver === 'undefined') {
    callback();
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        callback();
      }
    },
    { threshold: 0.35 },
  );

  observer.observe(element);
  cleanups.push(() => observer.disconnect());
}

function showElement(element: HTMLElement, animate: boolean, delay: number): void {
  if (!animate) {
    element.classList.add('is-visible');
    return;
  }
  element.style.setProperty('--delay', `${delay}ms`);
  schedule(() => {
    if (!element.isConnected) return;
    element.classList.add('is-visible');
  }, 16);
}

function setCounterValue(host: HTMLElement, value: number, format?: (value: number) => string): void {
  host.textContent = (format ?? ((next) => String(Math.round(next))))(value);
}

function restartCounter(host: HTMLElement, value: number, format?: (value: number) => string): void {
  if (!host.isConnected) return;
  const counter = createAnimatedCounter({ value, duration: 1100, format });
  host.replaceChildren(counter.el);
  counter.start();
}

function pulseClass(target: HTMLElement, className: string, duration = 480): void {
  target.classList.remove(className);
  void target.offsetWidth;
  target.classList.add(className);
  schedule(() => {
    if (!target.isConnected) return;
    target.classList.remove(className);
  }, duration);
}

function mountCounter(
  host: HTMLElement,
  value: number,
  animate: boolean,
  delay: number,
  format?: (value: number) => string,
): void {
  if (!animate) {
    setCounterValue(host, value, format);
    return;
  }

  schedule(() => restartCounter(host, value, format), delay);
}

function renderSortHeader<K extends string>(
  header: SortHeader<K>,
  state: SortState<K>,
  onSort: (key: K) => void,
): HTMLTableCellElement {
  const th = document.createElement('th');
  const button = document.createElement('button');
  const isActive = state.key === header.key;
  button.type = 'button';
  button.className = `pbla-sort-header${isActive ? ' pbla-sort-header--active' : ''}`;
  button.innerHTML = `<span>${header.label}</span><span class="pbla-sort-arrow${isActive && state.direction === 'desc' ? ' pbla-sort-arrow--desc' : ''}" aria-hidden="true">▲</span>`;
  button.addEventListener('click', () => onSort(header.key));
  th.setAttribute('aria-sort', isActive ? (state.direction === 'asc' ? 'ascending' : 'descending') : 'none');
  th.appendChild(button);
  return th;
}

function createSummaryCard(label: string, value: number, note: string, animate: boolean, delay: number): HTMLElement {
  const card = document.createElement('article');
  card.className = 'pbla-summary-card';

  const labelEl = document.createElement('span');
  labelEl.className = 'pbla-summary-card__label';
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = 'pbla-summary-card__value';
  mountCounter(valueEl, value, animate, delay);

  const noteEl = document.createElement('span');
  noteEl.className = 'pbla-summary-card__note';
  noteEl.textContent = note;

  card.append(labelEl, valueEl, noteEl);
  return card;
}

function buildHero(root: HTMLElement): {
  selectorBar: HTMLElement;
  seasonContent: HTMLElement;
  webglHost: HTMLElement;
  liveBadge: HTMLAnchorElement;
  liveText: HTMLSpanElement;
} {
  const webglHost = document.createElement('div');
  webglHost.className = 'pbla-webgl';
  root.appendChild(webglHost);

  const shell = document.createElement('div');
  shell.className = 'pbla-shell';

  const hero = document.createElement('section');
  hero.className = 'pbla-panel pbla-hero';

  const copy = document.createElement('div');
  copy.className = 'pbla-hero__copy';

  const kicker = document.createElement('div');
  kicker.className = 'pbla-kicker';
  kicker.innerHTML = '<span class="pbla-kicker__dot"></span> PBLA';

  const heading = document.createElement('div');
  heading.innerHTML = `
    <h1 class="pbla-hero__title">Philadelphia Box Lacrosse<span class="pbla-hero__title-accent">Association</span></h1>
    <p class="pbla-hero__subtitle">The <a href="https://phillyboxlacrosse.org/" target="_blank" rel="noopener noreferrer" style="color:var(--pbla-accent,#00e4ff);text-decoration:underline;">Philadelphia Box Lacrosse Association</a> has delivered summer box lacrosse at Rizzo Rink since 1986, pairing weeknight games with league-wide scoring races, playoff drama, and a long-running local lacrosse tradition.</p>
  `;

  const liveBadge = document.createElement('a');
  liveBadge.className = 'pbla-live-badge';
  liveBadge.href = 'https://www.youtube.com/@PBLA_Official';
  liveBadge.target = '_blank';
  liveBadge.rel = 'noopener noreferrer';

  const liveIcon = document.createElement('span');
  liveIcon.className = 'pbla-live-icon';
  liveIcon.setAttribute('aria-hidden', 'true');
  liveIcon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.7 31.7 0 0 0 0 12a31.7 31.7 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.7 31.7 0 0 0 24 12a31.7 31.7 0 0 0-.5-5.8ZM9.6 15.7V8.3l6.4 3.7-6.4 3.7Z"/></svg>';

  const liveDot = document.createElement('span');
  liveDot.className = 'pbla-live-dot';
  liveDot.setAttribute('aria-hidden', 'true');

  const liveText = document.createElement('span');
  liveText.className = 'pbla-live-text';

  liveBadge.append(liveIcon, liveDot, liveText);

  const chips = document.createElement('div');
  chips.className = 'pbla-hero__chips';
  chips.innerHTML = `
    <span class="pbla-chip">Est. 1986</span>
    <span class="pbla-chip">7 Teams</span>
    <span class="pbla-chip">Rizzo Rink</span>
  `;

  copy.append(kicker, heading, liveBadge, chips);

  const side = document.createElement('div');
  side.className = 'pbla-hero__side';

  const selectorCard = document.createElement('aside');
  selectorCard.className = 'pbla-side-card';
  selectorCard.innerHTML = `
    <p class="pbla-side-card__eyebrow">📅 Season selector</p>
    <h2 class="pbla-side-card__title">Current table and last season finish</h2>
    <p class="pbla-side-card__text">Flip between the current 2026 standings snapshot and the completed 2025 campaign to compare this summer's race with last year's playoff finish.</p>
  `;
  const selectorBar = document.createElement('div');
  selectorBar.className = 'pbla-season-bar';
  selectorCard.appendChild(selectorBar);

  const goalieCard = document.createElement('aside');
  goalieCard.className = 'pbla-side-card';
  goalieCard.innerHTML = `
    <p class="pbla-side-card__eyebrow">🧤 Top goalies</p>
    <h2 class="pbla-side-card__title">Save leaders this season</h2>
    <p class="pbla-side-card__text">Lowest goals-against average among goalies with at least 30 minutes played.</p>
  `;
  const goalieLane = document.createElement('div');
  goalieLane.className = 'pbla-goalie-lane';
  // Show top 4 goalies by GAA (lowest first), min 30 min played
  const currentSeason = SEASONS[0];
  const qualifiedGoalies = currentSeason
    ? currentSeason.goalies
        .filter((g) => g.min >= 30)
        .sort((a, b) => a.gaa - b.gaa)
        .slice(0, 4)
    : [];
  if (qualifiedGoalies.length > 0) {
    goalieLane.innerHTML = qualifiedGoalies
      .map(
        (g) => `
      <div class="pbla-goalie-pill" style="--team-color:${teamColor(g.team)}">
        <span class="pbla-goalie-pill__value">${g.gaa.toFixed(2)}</span>
        <span class="pbla-goalie-pill__label">${g.name.split(' ').pop()}</span>
        <span class="pbla-goalie-pill__team"><span class="pbla-goalie-pill__dot"></span>${teamAbbrev(g.team)}</span>
      </div>`,
      )
      .join('');
  } else {
    goalieLane.innerHTML = `
      <div class="pbla-goalie-pill"><span class="pbla-goalie-pill__value">--</span><span class="pbla-goalie-pill__label">No data yet</span></div>
    `;
  }
  goalieCard.appendChild(goalieLane);

  side.append(selectorCard, goalieCard);
  hero.append(copy, side);
  shell.appendChild(hero);

  const seasonContent = document.createElement('div');
  seasonContent.className = 'pbla-shell';
  shell.appendChild(seasonContent);

  const cta = document.createElement('section');
  cta.className = 'pbla-panel pbla-cta';
  cta.innerHTML = `
    <h2 class="pbla-cta__title">Watch PBLA and follow the league</h2>
    <p class="pbla-cta__text">Catch game night streams on PBLA TV, then track standings, scorers, and playoff movement from the official league site.</p>
    <div class="pbla-cta__links">
      <a class="pbla-cta__link" href="https://www.youtube.com/@PBLA_Official" target="_blank" rel="noopener noreferrer">PBLA TV</a>
      <a class="pbla-cta__link" href="https://phillyboxlacrosse.org/" target="_blank" rel="noopener noreferrer">PBLA website</a>
    </div>
  `;
  shell.appendChild(cta);

  root.appendChild(shell);
  return { selectorBar, seasonContent, webglHost, liveBadge, liveText };
}

function renderStandingsSection(
  season: PblaSeason,
  animate: boolean,
  webglHost: HTMLElement,
  token: number,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'pbla-panel pbla-section';

  const header = document.createElement('div');
  header.className = 'pbla-section__header';
  header.innerHTML = `
    <div>
      <span class="pbla-section__eyebrow">Season standings</span>
      <h2 class="pbla-section__title">Current standings</h2>
      <p class="pbla-section__subtitle">See where every team sits this season. Tap a team card for full roster and stats.</p>
    </div>
    <div class="pbla-section__meta">League ${season.year} - ${season.teams.length} clubs</div>
  `;
  section.appendChild(header);

  const ranked = [...season.teams].sort(compareTeams);
  const leagueRanks = new Map(ranked.map((team, index) => [team.id, index + 1]));
  const grid = document.createElement('div');
  grid.className = 'pbla-standings-grid';
  const cardCleanups: Array<() => void> = [];
  cleanupFns.push(() => clearScopedCleanup(cardCleanups));

  ranked.forEach((team, index) => {
    const color = teamColor(team.name);
    const palette = teamPalette(team.name);
    const card = document.createElement('a');
    const winPct = team.gp > 0 ? team.wins / team.gp : 0;
    card.className = 'pbla-team-card';
    card.href = `#/pbla/teams/${teamSlug(team.name)}`;
    card.style.setProperty('--team-color', color);
    card.style.setProperty('--team-secondary', palette.secondary);
    card.style.setProperty('--team-accent', palette.accent);

    const streakClass = team.streak.startsWith('W') ? 'pbla-streak pbla-streak--win' : 'pbla-streak pbla-streak--loss';
    card.innerHTML = `
      <div class="pbla-team-card__top">
        <div class="pbla-rank-pill">#${index + 1}</div>
        <div class="pbla-team-card__identity">
          <div class="pbla-team-card__headline">
            <span class="pbla-team-card__swatch" aria-hidden="true"></span>
            <h3 class="pbla-team-card__name">${team.name}</h3>
          </div>
          <div class="pbla-team-card__record">${team.wins}-${team.losses}-${team.ties} record across ${team.gp} games</div>
        </div>
        <div class="${streakClass}">${team.streak}</div>
      </div>
      <div class="pbla-team-card__stats">
        <div class="pbla-team-stat"><span class="pbla-team-stat__label">Pts</span><span class="pbla-team-stat__value" data-team-value="pts"></span></div>
        <div class="pbla-team-stat"><span class="pbla-team-stat__label">PF</span><span class="pbla-team-stat__value" data-team-value="pf"></span></div>
        <div class="pbla-team-stat"><span class="pbla-team-stat__label">PA</span><span class="pbla-team-stat__value" data-team-value="pa"></span></div>
        <div class="pbla-team-stat"><span class="pbla-team-stat__label">Diff</span><span class="pbla-team-stat__value" data-team-value="diff"></span></div>
      </div>
      <div class="pbla-team-card__win">
        <div class="pbla-team-card__win-meta"><span>Win rate</span><span>${Math.round(winPct * 100)}%</span></div>
        <div class="pbla-win-track"><div class="pbla-win-bar" style="--win-pct:${winPct}"></div></div>
      </div>
    `;

    const ptsEl = card.querySelector<HTMLElement>('[data-team-value="pts"]');
    const pfEl = card.querySelector<HTMLElement>('[data-team-value="pf"]');
    const paEl = card.querySelector<HTMLElement>('[data-team-value="pa"]');
    const diffEl = card.querySelector<HTMLElement>('[data-team-value="diff"]');
    const swatchEl = card.querySelector<HTMLElement>('.pbla-team-card__swatch');
    const winBar = card.querySelector<HTMLElement>('.pbla-win-bar');

    const runCounters = (): void => {
      if (ptsEl) restartCounter(ptsEl, team.pts);
      if (pfEl) restartCounter(pfEl, team.pf);
      if (paEl) restartCounter(paEl, team.pa);
      if (diffEl) restartCounter(diffEl, team.diff, formatSigned);
    };

    observeOnEnter(card, animate, () => {
      winBar?.classList.add('is-visible');
      if (animate) {
        runCounters();
      } else {
        if (ptsEl) setCounterValue(ptsEl, team.pts);
        if (pfEl) setCounterValue(pfEl, team.pf);
        if (paEl) setCounterValue(paEl, team.pa);
        if (diffEl) setCounterValue(diffEl, team.diff, formatSigned);
      }
    }, cardCleanups);

    const retrigger = (): void => {
      if (!animate) return;
      runCounters();
      if (swatchEl) pulseClass(swatchEl, 'is-pulsing');
    };
    card.addEventListener('pointerenter', retrigger);
    card.addEventListener('focus', retrigger);
    cardCleanups.push(() => {
      card.removeEventListener('pointerenter', retrigger);
      card.removeEventListener('focus', retrigger);
    });

    showElement(card, animate, index * 80);
    attachBurstTarget(card, webglHost, color, token, cardCleanups);
    grid.appendChild(card);
  });

  section.appendChild(grid);
  return section;
}

function renderUpcomingGamesSection(season: PblaSeason, animate: boolean): HTMLElement {
  const now = Date.now();
  const sevenDaysOut = now + 7 * 24 * 60 * 60 * 1000;
  const upcoming = [...season.games]
    .filter((g) => {
      const ts = parseGameTimestamp(g);
      return ts > now && ts <= sevenDaysOut && g.homeScore === 0 && g.awayScore === 0;
    })
    .sort((a, b) => parseGameTimestamp(a) - parseGameTimestamp(b));

  const section = document.createElement('section');
  section.className = 'pbla-panel pbla-section';

  const header = document.createElement('div');
  header.className = 'pbla-section__header';
  header.innerHTML = `
    <div>
      <span class="pbla-section__eyebrow">&#128197; Upcoming games</span>
      <h2 class="pbla-section__title">Next up at Rizzo Rink</h2>
    </div>
    <div class="pbla-section__meta">${upcoming.length} game${upcoming.length !== 1 ? 's' : ''} scheduled</div>
  `;
  section.appendChild(header);

  if (upcoming.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pbla-games-empty';
    empty.textContent = 'No upcoming games scheduled yet. Check back soon for the next game night!';
    section.appendChild(empty);
    return section;
  }

  const grid = document.createElement('div');
  grid.className = 'pbla-games-grid';

  upcoming.slice(0, 10).forEach((game, index) => {
    const card = document.createElement('article');
    card.className = `pbla-game-card pbla-game-card--upcoming${game.isPlayoff ? ' pbla-game-card--playoff' : ''}`;

    const badges = [
      game.isPlayoff ? '<span class="pbla-game-card__badge pbla-game-card__badge--playoff">Playoff</span>' : '',
    ].filter(Boolean).join('');

    card.innerHTML = `
      <div class="pbla-game-card__top">
        <div class="pbla-game-card__date">${formatGameCardDate(game)}</div>
        ${badges ? `<div class="pbla-game-card__badges">${badges}</div>` : ''}
      </div>
      <div class="pbla-game-card__matchup">
        <span class="pbla-game-card__team">${game.awayTeam}</span>
        <span class="pbla-game-card__vs">at</span>
        <span class="pbla-game-card__team">${game.homeTeam}</span>
      </div>
      <div class="pbla-game-card__footer">
        <span class="pbla-game-card__time">${game.time}</span>
        <span class="pbla-game-card__location">${game.location}</span>
      </div>
    `;

    showElement(card, animate, index * 55);
    grid.appendChild(card);
  });

  section.appendChild(grid);
  return section;
}

function renderGamesSection(season: PblaSeason, animate: boolean): HTMLElement {
  const games = [...season.games].sort((a, b) => parseGameTimestamp(b) - parseGameTimestamp(a));
  const section = document.createElement('section');
  section.className = 'pbla-panel pbla-section';

  const header = document.createElement('div');
  header.className = 'pbla-section__header';
  header.innerHTML = `
    <div>
      <span class="pbla-section__eyebrow">Recent games</span>
      <h2 class="pbla-section__title">Latest results from Rizzo Rink</h2>

    </div>
    <div class="pbla-section__meta">${season.year} season - ${games.length} results</div>
  `;
  section.appendChild(header);

  if (games.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pbla-games-empty';
    empty.textContent = `No ${season.year} results recorded yet. Scores will appear here after game nights.`;
    section.appendChild(empty);
    return section;
  }

  const grid = document.createElement('div');
  grid.className = 'pbla-games-grid';
  section.appendChild(grid);

  let showAll = false;
  const toggle = games.length > 10 ? document.createElement('button') : null;
  if (toggle) {
    toggle.type = 'button';
    toggle.className = 'pbla-games-toggle';
    const handleToggle = (): void => {
      showAll = !showAll;
      renderCards();
    };
    toggle.addEventListener('click', handleToggle);
    cleanupFns.push(() => toggle.removeEventListener('click', handleToggle));
    section.appendChild(toggle);
  }

  function renderCards(): void {
    grid.replaceChildren();
    const visibleGames = showAll ? games : games.slice(0, 10);
    visibleGames.forEach((game, index) => {
      const awayWins = game.awayScore > game.homeScore;
      const homeWins = game.homeScore > game.awayScore;
      const card = document.createElement('article');
      card.className = `pbla-game-card${game.isPlayoff ? ' pbla-game-card--playoff' : ''}`;

      const badges = [
        game.isPlayoff ? '<span class="pbla-game-card__badge pbla-game-card__badge--playoff">Playoff</span>' : '',
        game.note ? `<span class="pbla-game-card__badge pbla-game-card__badge--note">${game.note}</span>` : '',
      ].filter(Boolean).join('');

      card.innerHTML = `
        <div class="pbla-game-card__top">
          <div class="pbla-game-card__date">${formatGameCardDate(game)}</div>
          ${badges ? `<div class="pbla-game-card__badges">${badges}</div>` : ''}
        </div>
        <div class="pbla-game-card__matchup">
          <span class="pbla-game-card__team${awayWins ? ' pbla-game-card__team--winner' : ''}">${game.awayTeam} ${game.awayScore}</span>
          <span class="pbla-game-card__vs">at</span>
          <span class="pbla-game-card__team${homeWins ? ' pbla-game-card__team--winner' : ''}">${game.homeTeam} ${game.homeScore}</span>
        </div>
      `;

      showElement(card, animate, index * 55);
      grid.appendChild(card);
    });

    if (toggle) {
      toggle.textContent = showAll ? 'Show fewer games' : `Show all ${games.length} games`;
    }
  }

  renderCards();
  return section;
}

function renderLeadersSection(
  season: PblaSeason,
  animate: boolean,
  webglHost: HTMLElement,
  token: number,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'pbla-panel pbla-section';

  const header = document.createElement('div');
  header.className = 'pbla-section__header';
  header.innerHTML = `
    <div>
      <h2 class="pbla-section__title" style="font-size:1.6rem">&#127942; Scoring leaders</h2>
    </div>
    <div class="pbla-section__meta">Top 20 players - ${season.year} season</div>
  `;
  section.appendChild(header);

  const shell = document.createElement('div');
  shell.className = 'pbla-table-shell';

  const table = document.createElement('table');
  table.className = 'pbla-data-table pbla-leaders-table';
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');
  table.append(thead, tbody);
  shell.appendChild(table);
  section.appendChild(shell);

  const topPointTotal = topPoints(season);
  const rowCleanups: Array<() => void> = [];
  cleanupFns.push(() => clearScopedCleanup(rowCleanups));
  const headers: SortHeader<PlayerSortKey>[] = [
    { key: 'name', label: 'Name' },
    { key: 'team', label: 'Team' },
    { key: 'points', label: 'Pts' },
    { key: 'goals', label: 'G' },
    { key: 'assists', label: 'A' },
    { key: 'gp', label: 'GP' },
    { key: 'pim', label: 'PIM' },
  ];
  let sortState: SortState<PlayerSortKey> = { key: 'points', direction: 'desc' };

  const renderTable = (): void => {
    clearScopedCleanup(rowCleanups);
    const headRow = document.createElement('tr');
    const rankHeader = document.createElement('th');
    rankHeader.textContent = '#';
    headRow.appendChild(rankHeader);
    headers.forEach((entry) => {
      headRow.appendChild(
        renderSortHeader(entry, sortState, (key) => {
          sortState = toggleSort(sortState, key);
          renderTable();
        }),
      );
    });
    thead.replaceChildren(headRow);

    const players = sortPlayers(season.players, sortState).slice(0, 20);
    tbody.replaceChildren();
    players.forEach((player, index) => {
      const row = document.createElement('tr');
      const swatch = teamColor(player.team);
      row.className = 'pbla-leaders-row';
      row.style.setProperty('--team-color', swatch);

      row.innerHTML = `
        <td class="pbla-rank-cell">${index + 1}${index === 0 ? '<span class="pbla-rank-fire" aria-hidden="true">🔥</span>' : ''}</td>
        <td class="pbla-player-cell"><span class="pbla-player-cell__jersey">#${player.jersey}</span><span class="pbla-player-cell__name">${player.name}</span></td>
        <td class="pbla-team-cell"><span class="pbla-team-swatch" style="--swatch-color:${swatch}"></span>${player.team}</td>
        <td class="pbla-points-cell" data-player-value="points"></td>
        <td data-player-value="goals"></td>
        <td data-player-value="assists"></td>
        <td data-player-value="gp"></td>
        <td data-player-value="pim"></td>
      `;

      const pointsBar = document.createElement('div');
      pointsBar.className = 'pbla-points-bar';
      pointsBar.style.setProperty('--team-color', swatch);
      pointsBar.style.setProperty('--pts-pct', String(topPointTotal > 0 ? player.points / topPointTotal : 0));
      pointsBar.style.width = '100%';
      row.prepend(pointsBar);

      const gpEl = row.querySelector<HTMLElement>('[data-player-value="gp"]');
      const goalsEl = row.querySelector<HTMLElement>('[data-player-value="goals"]');
      const assistsEl = row.querySelector<HTMLElement>('[data-player-value="assists"]');
      const pointsEl = row.querySelector<HTMLElement>('[data-player-value="points"]');
      const pimEl = row.querySelector<HTMLElement>('[data-player-value="pim"]');
      const baseDelay = 140 + index * 72;
      if (gpEl) mountCounter(gpEl, player.gp, animate, baseDelay);
      if (goalsEl) mountCounter(goalsEl, player.goals, animate, baseDelay + 35);
      if (assistsEl) mountCounter(assistsEl, player.assists, animate, baseDelay + 70);
      if (pimEl) mountCounter(pimEl, player.pim, animate, baseDelay + 145);
      if (pointsEl && !animate) setCounterValue(pointsEl, player.points);

      observeOnEnter(row, animate, () => {
        pointsBar.classList.add('is-visible');
        if (pointsEl) {
          if (animate) {
            restartCounter(pointsEl, player.points);
          } else {
            setCounterValue(pointsEl, player.points);
          }
        }
      }, rowCleanups);

      showElement(row, animate, index * 72);
      if (index < 5) attachBurstTarget(row, webglHost, swatch, token, rowCleanups);
      tbody.appendChild(row);
    });
  };

  renderTable();
  return section;
}

function renderSeasonSummary(season: PblaSeason, animate: boolean): HTMLElement {
  const summary = document.createElement('section');
  summary.className = 'pbla-season-summary';

  const ranked = [...season.teams].sort(compareTeams);
  const leader = ranked[0];
  const leaderName = leader ? leader.name : 'PBLA';
  summary.append(
    createSummaryCard('Teams', season.teams.length, `${season.teams.length} teams competing this season.`, animate, 60),
    createSummaryCard('Total goals', sumGoalsFor(season), `${leaderName} leads the league in scoring.`, animate, 140),
    createSummaryCard('Points leader', topPoints(season), 'Most points by a single player this season.', animate, 220),
    createSummaryCard('Games played', season.teams.reduce((sum, t) => sum + t.gp, 0) / 2, 'Total games completed so far.', animate, 300),
  );

  return summary;
}

function renderSeasonContent(
  host: HTMLElement,
  season: PblaSeason,
  animate: boolean,
  webglHost: HTMLElement,
  token: number,
): void {
  host.replaceChildren();
  const ranked = [...season.teams].sort(compareTeams);
  const leader = ranked[0];
  const leadPlayer = season.players[0];

  const overview = document.createElement('section');
  overview.className = 'pbla-panel pbla-section';
  overview.innerHTML = `
    <div class="pbla-section__header">
      <div>
        <span class="pbla-section__eyebrow">Season overview</span>
        <h2 class="pbla-section__title">${season.year === 2026 ? 'The 2026 season is underway' : '2025 season final standings'}</h2>
        <p class="pbla-section__subtitle">${season.year === 2026 ? 'Games are live every Monday and Wednesday night at Rizzo Rink. Check the standings, see who is leading the scoring race, and find out where your team sits.' : 'The 2025 PBLA season is in the books. Here is how every team finished and who took home the hardware.'}</p>
      </div>
      <div class="pbla-section__meta">${leader ? `<span class="pbla-meta-badge pbla-meta-badge--gold">🏆 1st place: ${leader.name}</span>` : ''}${leadPlayer ? `<span class="pbla-meta-badge pbla-meta-badge--fire">🔥 Points leader: ${leadPlayer.name}</span>` : ''}</div>
    </div>
  `;
  overview.appendChild(renderSeasonSummary(season, animate));
  host.appendChild(overview);
  host.appendChild(renderStandingsSection(season, animate, webglHost, token));
  host.appendChild(renderUpcomingGamesSection(season, animate));
  host.appendChild(renderGamesSection(season, animate));
  host.appendChild(renderLeadersSection(season, animate, webglHost, token));
}

function renderSeasonButtons(
  host: HTMLElement,
  seasons: PblaSeason[],
  selectedYear: number,
  onSelect: (year: number) => void,
): void {
  host.replaceChildren();
  seasons.forEach((season) => {
    const button = document.createElement('button');
    const handleClick = (): void => onSelect(season.year);
    button.type = 'button';
    button.className = `pbla-season-btn${season.year === selectedYear ? ' is-active' : ''}`;
    button.textContent = 'label' in season && typeof season.label === 'string' ? season.label : String(season.year);
    button.setAttribute('aria-pressed', String(season.year === selectedYear));
    button.addEventListener('click', handleClick);
    cleanupFns.push(() => button.removeEventListener('click', handleClick));
    host.appendChild(button);
  });
}

export function render(root: HTMLElement, _params: Record<string, string>): void {
  destroy();
  ensureStyles();
  setPageMeta({
    title: 'PBLA - Philadelphia Box Lacrosse Association',
    description: 'Philadelphia Box Lacrosse Association standings, recent results, scorers, and league highlights with WebGL motion.',
  });

  renderToken += 1;
  const token = renderToken;
  const seasons = [...SEASONS].sort((a, b) => b.year - a.year);
  let selectedYear = seasons[0]?.year ?? 2026;
  const animate = shouldAnimate();

  root.replaceChildren();
  root.classList.add('pbla-view-root');
  activeRoot = root;

  const { selectorBar, seasonContent, webglHost, liveBadge, liveText } = buildHero(root);

  const refreshLiveBadge = (): void => updateLiveBadge(liveBadge, liveText);
  refreshLiveBadge();
  const liveInterval = window.setInterval(refreshLiveBadge, 60_000);
  cleanupFns.push(() => window.clearInterval(liveInterval));

  const updateSeason = (year: number): void => {
    if (token !== renderToken) return;
    selectedYear = year;
    const season = seasons.find((entry) => entry.year === selectedYear) ?? seasons[0];
    if (!season) return;
    renderSeasonButtons(selectorBar, seasons, selectedYear, updateSeason);
    renderSeasonContent(seasonContent, season, animate, webglHost, token);
  };

  updateSeason(selectedYear);

  if (shouldMountWebGL()) {
    schedule(() => {
      if (token !== renderToken) return;
      mountWebGL(webglHost, token);
    }, 60);
  }
}

export function destroy(): void {
  renderToken += 1;
  clearPendingTimers();
  clearCleanup();
  destroyWebGL();
  activeRoot?.classList.remove('pbla-view-root');
  activeRoot = null;
}
