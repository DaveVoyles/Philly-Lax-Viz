import { getTeams, type TeamSeasonRecord } from '../api.js';
import { renderTeamBadge } from '../components/teamBadge.js';
import { createAnimatedCounter } from '../components/animatedCounter.js';
import { shouldAnimate, shouldMountWebGL } from '../util/motionPrefs.js';
import { IS_STATIC, staticFetch } from '../staticLoader.js';
import { Application, Graphics } from 'pixi.js';

const STYLE_ID = 'top-teams-view-styles';
const PARTICLE_COUNT = 40;
const CONNECT_DISTANCE = 100;
const CONNECT_DISTANCE_SQ = CONNECT_DISTANCE * CONNECT_DISTANCE;
const PARTICLE_COLORS = [0xffd166, 0x4ea1ff, 0x34d399] as const;
const FALLBACK_ACCENT = '#4ea1ff';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: number;
}

let renderToken = 0;
let activeObserver: IntersectionObserver | null = null;
let activeApp: Application | null = null;
let activeHost: HTMLElement | null = null;
let activeRoot: HTMLElement | null = null;
let pendingTimers: number[] = [];

function ensureStyles(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;

  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .top-teams-view-root {
      position: relative;
      isolation: isolate;
      padding-bottom: 1rem;
    }
    .top-teams-webgl {
      position: absolute;
      inset: 0;
      z-index: -1;
      pointer-events: none;
      overflow: hidden;
    }
    .top-teams-shell {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .top-teams-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.2rem;
    }
    .top-teams-title__emoji {
      font-size: 1.4rem;
      line-height: 1;
      filter: drop-shadow(0 0 10px rgba(255, 209, 102, 0.35));
    }
    .top-teams-subtitle {
      margin-top: 0;
      color: var(--muted);
    }
    .top-teams-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1rem;
      align-items: stretch;
    }
    .top-team-card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      min-height: 220px;
      border-radius: 12px;
      padding: 1.25rem 1.5rem;
      background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0)), var(--bg-elev, #11151a);
      border: 1px solid var(--border);
      transition: transform 0.2s ease, box-shadow 0.3s ease;
      overflow: hidden;
    }
    .top-team-card::after {
      content: '';
      position: absolute;
      inset: auto -10% -35% auto;
      width: 180px;
      height: 180px;
      border-radius: 999px;
      background: radial-gradient(circle, color-mix(in srgb, var(--team-accent, #4ea1ff) 24%, transparent), transparent 72%);
      pointer-events: none;
      opacity: 0.9;
    }
    .top-team-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 24px rgba(78, 161, 255, 0.2);
    }
    .top-team-card--rank-1 {
      grid-column: 1 / -1;
      min-height: 260px;
      border: 2px solid #ffd166;
      box-shadow: 0 0 20px rgba(255, 209, 102, 0.15);
    }
    .top-team-card--rank-2,
    .top-team-card--rank-3 {
      min-height: 230px;
    }
    .top-team-card--rank-4,
    .top-team-card--rank-5 {
      min-height: 200px;
    }
    .top-team-card__topline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .top-team-card__badge-link,
    .top-team-card__badge-link:visited {
      color: inherit;
      text-decoration: none;
    }
    .top-team-card__badge-link .team-badge__name {
      font-weight: 800;
      font-size: 1.05rem;
      letter-spacing: 0.01em;
    }
    .top-team-card--rank-1 .top-team-card__badge-link .team-badge__name {
      font-size: 1.2rem;
    }
    .top-team-card__body {
      display: grid;
      gap: 0.85rem;
    }
    .top-team-rank {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 54px;
      min-height: 54px;
      padding: 0.25rem 0.85rem;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--rank-color, #6b7280) 40%, transparent);
      background: color-mix(in srgb, var(--rank-color, #6b7280) 16%, transparent);
      color: var(--rank-color, #6b7280);
      font-size: 1.1rem;
      font-weight: 800;
      letter-spacing: 0.02em;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04);
    }
    .top-team-card--rank-1 .top-team-rank {
      min-width: 64px;
      min-height: 64px;
      font-size: 1.3rem;
    }
    .top-team-streak {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.35rem 0.7rem;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.04);
      font-size: 0.82rem;
      font-weight: 700;
      letter-spacing: 0.03em;
      color: #f8fafc;
    }
    .top-team-streak--win {
      color: #86efac;
      border-color: rgba(134, 239, 172, 0.25);
      background: rgba(34, 197, 94, 0.12);
    }
    .top-team-streak--loss {
      color: #fca5a5;
      border-color: rgba(252, 165, 165, 0.25);
      background: rgba(239, 68, 68, 0.12);
    }
    .top-team-card__stats {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.85rem;
      align-items: end;
    }
    .top-team-stat {
      display: grid;
      gap: 0.25rem;
    }
    .top-team-stat__label {
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .top-team-stat__value {
      display: inline-flex;
      align-items: baseline;
      gap: 0.2rem;
      font-size: 1.65rem;
      font-weight: 800;
      line-height: 1;
    }
    .top-team-stat__sep,
    .top-team-stat__suffix {
      color: var(--muted);
      font-size: 0.92rem;
      font-weight: 700;
    }
    .top-team-progress {
      display: grid;
      gap: 0.45rem;
    }
    .top-team-progress__meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      font-size: 0.82rem;
      color: var(--muted);
    }
    .top-team-progress__track {
      position: relative;
      width: 100%;
      height: 10px;
      border-radius: 999px;
      overflow: hidden;
      background: rgba(148, 163, 184, 0.16);
      border: 1px solid rgba(148, 163, 184, 0.12);
    }
    .top-team-progress__fill {
      width: 0;
      height: 100%;
      border-radius: inherit;
      background: var(--team-accent, #4ea1ff);
      box-shadow: 0 0 14px color-mix(in srgb, var(--team-accent, #4ea1ff) 60%, transparent);
      transition: width 900ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .top-team-progress__fill.is-animated {
      width: var(--target-width, 0%);
    }
    .top-teams-state {
      padding: 1rem 1.1rem;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: var(--bg-elev, #11151a);
    }
    .top-teams-state--error {
      border-color: rgba(239, 68, 68, 0.4);
      color: #fecaca;
    }
    @media (max-width: 860px) {
      .top-teams-grid {
        grid-template-columns: 1fr;
      }
      .top-team-card,
      .top-team-card--rank-1,
      .top-team-card--rank-2,
      .top-team-card--rank-3,
      .top-team-card--rank-4,
      .top-team-card--rank-5 {
        grid-column: auto;
        min-height: unset;
      }
    }
    @media (max-width: 560px) {
      .top-team-card {
        padding: 1rem 1.1rem;
      }
      .top-team-card__stats {
        grid-template-columns: 1fr;
      }
      .top-team-stat__value {
        font-size: 1.45rem;
      }
    }
  `;
  doc.head.appendChild(style);
}

function normalizeLogoUrl(logoUrl: string | null): string | null {
  if (!logoUrl) return null;
  if (/^https?:\/\//i.test(logoUrl) || logoUrl.startsWith('/logos/')) return logoUrl;
  return `/logos/${logoUrl.replace(/^\/+/, '')}`;
}

function winPct(team: TeamSeasonRecord): number {
  const gamesPlayed = team.wins + team.losses;
  if (gamesPlayed <= 0) return 0;
  return team.wins / gamesPlayed;
}

function compareTeams(a: TeamSeasonRecord, b: TeamSeasonRecord): number {
  const winsDiff = b.wins - a.wins;
  if (winsDiff !== 0) return winsDiff;
  const pctDiff = winPct(b) - winPct(a);
  if (Math.abs(pctDiff) > 0.000001) return pctDiff > 0 ? 1 : -1;
  return a.name.localeCompare(b.name);
}

function rankColor(rank: number): string {
  if (rank === 1) return '#ffd166';
  if (rank === 2) return '#c0c0c0';
  if (rank === 3) return '#cd7f32';
  return 'var(--muted)';
}

function streakText(streak: number | null | undefined): string | null {
  if (typeof streak !== 'number' || streak === 0) return null;
  return streak > 0 ? `W${streak}` : `L${Math.abs(streak)}`;
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

function destroyWebGL(): void {
  if (activeApp) {
    activeApp.destroy(true, { children: true, texture: true });
    activeApp = null;
  }
  if (activeHost) {
    activeHost.replaceChildren();
    activeHost = null;
  }
}

function destroyObserver(): void {
  activeObserver?.disconnect();
  activeObserver = null;
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

function seededY(height: number): number {
  return Math.pow(Math.random(), 1.85) * Math.max(height * 0.68, 1);
}

function seededX(width: number): number {
  if (Math.random() < 0.65) {
    const spread = width * 0.24;
    return width * 0.5 + (Math.random() * 2 - 1) * spread;
  }
  return Math.random() * width;
}

function makeParticles(width: number, height: number): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    x: seededX(width),
    y: seededY(height),
    vx: (Math.random() * 0.22 + 0.04) * (Math.random() > 0.5 ? 1 : -1),
    vy: Math.random() * 0.14 + 0.03,
    radius: Math.random() * 2.2 + 1.6,
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
  let particles: Particle[] = [];
  let lastSize = { width: 0, height: 0 };

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

    for (const particle of particles) {
      particle.x = wrap(particle.x + particle.vx * delta, width);
      particle.y = wrap(particle.y + particle.vy * delta, height);
      if (particle.y > height + 10) particle.y = -10;
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
        const alpha = 0.14 * (1 - distanceSq / CONNECT_DISTANCE_SQ);
        lineLayer.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: a.color, alpha });
      }
    }

    for (const particle of particles) {
      particleLayer.circle(particle.x, particle.y, particle.radius).fill({ color: particle.color, alpha: 0.72 });
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
    app.canvas.style.display = 'block';
    app.canvas.style.width = '100%';
    app.canvas.style.height = '100%';
    stage.appendChild(app.canvas);
    app.ticker.add(tick);
    tick();
  });
}

async function loadTeams(): Promise<TeamSeasonRecord[]> {
  if (IS_STATIC) {
    return staticFetch<TeamSeasonRecord[]>('/data/teams.json');
  }
  return getTeams();
}

function buildCard(team: TeamSeasonRecord, rank: number, animateCards: boolean): HTMLElement {
  const card = document.createElement('article');
  const accent = team.primaryColor ?? FALLBACK_ACCENT;
  card.className = `top-team-card top-team-card--rank-${rank}`;
  card.style.setProperty('--team-accent', accent);
  card.style.setProperty('--rank-color', rankColor(rank));

  const topline = document.createElement('div');
  topline.className = 'top-team-card__topline';

  const badge = document.createElement('span');
  badge.className = 'top-team-rank';
  badge.textContent = `#${rank}`;
  topline.appendChild(badge);

  const streak = streakText(team.streak ?? null);
  if (streak) {
    const chip = document.createElement('span');
    chip.className = `top-team-streak ${streak.startsWith('W') ? 'top-team-streak--win' : 'top-team-streak--loss'}`;
    chip.textContent = streak;
    topline.appendChild(chip);
  }

  const body = document.createElement('div');
  body.className = 'top-team-card__body';

  const teamBadge = renderTeamBadge({
    name: team.name,
    logoUrl: normalizeLogoUrl(team.logoUrl),
    primaryColor: team.primaryColor,
    size: rank === 1 ? 'xl' : rank <= 3 ? 'lg' : 'md',
    href: `#/teams/${team.id}`,
  });
  if (teamBadge instanceof HTMLAnchorElement) {
    teamBadge.classList.add('top-team-card__badge-link');
  }
  body.appendChild(teamBadge);

  const stats = document.createElement('div');
  stats.className = 'top-team-card__stats';

  const record = document.createElement('div');
  record.className = 'top-team-stat';
  const recordLabel = document.createElement('span');
  recordLabel.className = 'top-team-stat__label';
  recordLabel.textContent = 'Record';
  const recordValue = document.createElement('div');
  recordValue.className = 'top-team-stat__value';
  const duration = animateCards ? 1200 : 1;
  const winsCounter = createAnimatedCounter({ value: team.wins, duration });
  const lossesCounter = createAnimatedCounter({ value: team.losses, duration });
  const winsSuffix = document.createElement('span');
  winsSuffix.className = 'top-team-stat__suffix';
  winsSuffix.textContent = 'W';
  const separator = document.createElement('span');
  separator.className = 'top-team-stat__sep';
  separator.textContent = '-';
  const lossesSuffix = document.createElement('span');
  lossesSuffix.className = 'top-team-stat__suffix';
  lossesSuffix.textContent = 'L';
  recordValue.append(winsCounter.el, winsSuffix, separator, lossesCounter.el, lossesSuffix);
  record.append(recordLabel, recordValue);
  stats.appendChild(record);

  const gamesPlayed = team.wins + team.losses;
  const gamesStat = document.createElement('div');
  gamesStat.className = 'top-team-stat';
  const gamesLabel = document.createElement('span');
  gamesLabel.className = 'top-team-stat__label';
  gamesLabel.textContent = 'Games Played';
  const gamesValue = document.createElement('div');
  gamesValue.className = 'top-team-stat__value';
  gamesValue.textContent = String(gamesPlayed);
  gamesStat.append(gamesLabel, gamesValue);
  stats.appendChild(gamesStat);

  body.appendChild(stats);

  const progress = document.createElement('div');
  progress.className = 'top-team-progress';
  const progressMeta = document.createElement('div');
  progressMeta.className = 'top-team-progress__meta';
  const progressLabel = document.createElement('span');
  progressLabel.textContent = 'Win %';
  const pct = winPct(team);
  const progressValue = document.createElement('strong');
  progressValue.textContent = `${(pct * 100).toFixed(1)}%`;
  progressMeta.append(progressLabel, progressValue);
  const track = document.createElement('div');
  track.className = 'top-team-progress__track';
  const fill = document.createElement('div');
  fill.className = 'top-team-progress__fill';
  fill.style.setProperty('--target-width', `${(pct * 100).toFixed(1)}%`);
  track.appendChild(fill);
  progress.append(progressMeta, track);
  body.appendChild(progress);

  card.append(topline, body);

  const startAnimation = (): void => {
    schedule(() => {
      winsCounter.start();
      lossesCounter.start();
      fill.classList.add('is-animated');
    }, Math.max(0, rank - 1) * 100);
  };

  if (animateCards && 'IntersectionObserver' in window) {
    card.dataset['observeAnimate'] = 'true';
    (card as HTMLElement & { __startAnimation?: () => void }).__startAnimation = startAnimation;
  } else {
    startAnimation();
  }

  return card;
}

function attachRevealObserver(cards: HTMLElement[]): void {
  destroyObserver();
  if (!cards.length || !('IntersectionObserver' in window) || !shouldAnimate()) {
    for (const card of cards) {
      const start = (card as HTMLElement & { __startAnimation?: () => void }).__startAnimation;
      start?.();
    }
    return;
  }

  activeObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const target = entry.target as HTMLElement & { __startAnimation?: () => void };
      target.__startAnimation?.();
      activeObserver?.unobserve(target);
    }
  }, { threshold: 0.2 });

  for (const card of cards) activeObserver.observe(card);
}

async function renderTopTeams(root: HTMLElement, token: number): Promise<void> {
  const grid = root.querySelector<HTMLElement>('[data-top-teams-grid]');
  const status = root.querySelector<HTMLElement>('[data-top-teams-status]');
  if (!grid || !status) return;

  try {
    const teams = await loadTeams();
    if (token !== renderToken) return;

    const ranked = [...teams]
      .filter((team) => team.wins + team.losses > 0)
      .sort(compareTeams)
      .slice(0, 5);

    status.className = 'top-teams-state';
    status.style.display = '';
    status.replaceChildren();
    grid.replaceChildren();

    if (ranked.length === 0) {
      status.textContent = 'No completed games yet, so there is no podium to show.';
      return;
    }

    status.style.display = 'none';

    const animateCards = shouldAnimate();
    const cards = ranked.map((team, index) => buildCard(team, index + 1, animateCards));
    grid.append(...cards);
    if (animateCards) {
      attachRevealObserver(cards);
    }
  } catch (error) {
    if (token !== renderToken) return;
    grid.replaceChildren();
    status.style.display = '';
    status.className = 'top-teams-state top-teams-state--error';
    status.textContent = error instanceof Error ? error.message : 'Failed to load teams.';
  }
}

export function render(root: HTMLElement, _params: Record<string, string>): void {
  destroy();
  ensureStyles();

  renderToken += 1;
  const token = renderToken;

  root.replaceChildren();
  root.classList.add('top-teams-view-root');
  activeRoot = root;

  const webglHost = document.createElement('div');
  webglHost.className = 'top-teams-webgl';
  root.appendChild(webglHost);

  const shell = document.createElement('section');
  shell.className = 'top-teams-shell';

  const header = document.createElement('header');
  const title = document.createElement('h1');
  title.className = 'top-teams-title';
  const emoji = document.createElement('span');
  emoji.className = 'top-teams-title__emoji';
  emoji.textContent = '🔥';
  const titleText = document.createElement('span');
  titleText.textContent = 'Top 5 Teams';
  title.append(emoji, titleText);
  const subtitle = document.createElement('p');
  subtitle.className = 'top-teams-subtitle';
  subtitle.textContent = 'The best records in the league right now';
  header.append(title, subtitle);
  shell.appendChild(header);

  const status = document.createElement('div');
  status.className = 'top-teams-state';
  status.dataset['topTeamsStatus'] = 'true';
  status.textContent = 'Loading podium...';
  shell.appendChild(status);

  const grid = document.createElement('section');
  grid.className = 'top-teams-grid';
  grid.dataset['topTeamsGrid'] = 'true';
  shell.appendChild(grid);

  root.appendChild(shell);

  if (shouldMountWebGL()) {
    mountWebGL(webglHost, token);
  }

  void renderTopTeams(root, token);
}

export function destroy(): void {
  renderToken += 1;
  destroyObserver();
  clearPendingTimers();
  destroyWebGL();
  activeRoot?.classList.remove('top-teams-view-root');
  activeRoot = null;
}
