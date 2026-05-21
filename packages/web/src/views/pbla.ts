import { Application, Graphics } from 'pixi.js';
import { shouldAnimate, shouldMountWebGL } from '../util/motionPrefs.js';
import { createAutoCounter } from '../components/animatedCounter.js';
import { setPageMeta } from '../util/pageMeta.js';
import { SEASONS, teamColor, type PblaSeason, type PblaTeam, type PblaPlayer } from './pblaData.js';

const STYLE_ID = 'pbla-view-styles';
const PARTICLE_COUNT = 50;
const CONNECT_DISTANCE = 120;
const CONNECT_DISTANCE_SQ = CONNECT_DISTANCE * CONNECT_DISTANCE;
const PARTICLE_COLORS = [0xf68c1f, 0xffd166, 0xf8fafc] as const;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: number;
}

let renderToken = 0;
let activeApp: Application | null = null;
let activeHost: HTMLElement | null = null;
let pendingTimers: number[] = [];

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .pbla-root {
      position: relative;
      isolation: isolate;
      padding-bottom: 2rem;
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
      gap: 2rem;
    }

    /* Hero */
    .pbla-hero {
      text-align: center;
      padding: 2.5rem 1rem 1.5rem;
    }
    .pbla-hero__badge {
      display: inline-block;
      padding: 0.3rem 0.8rem;
      border-radius: 999px;
      background: rgba(246, 140, 31, 0.15);
      border: 1px solid rgba(246, 140, 31, 0.4);
      color: #f68c1f;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 1rem;
    }
    .pbla-hero__title {
      font-size: 2rem;
      font-weight: 900;
      letter-spacing: -0.02em;
      margin: 0 0 0.5rem;
      background: linear-gradient(135deg, #f68c1f, #ffd166);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .pbla-hero__subtitle {
      color: var(--muted);
      font-size: 0.95rem;
      margin: 0;
    }

    /* Season selector */
    .pbla-season-bar {
      display: flex;
      justify-content: center;
      gap: 0.5rem;
    }
    .pbla-season-btn {
      padding: 0.45rem 1rem;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--muted);
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .pbla-season-btn--active {
      background: rgba(246, 140, 31, 0.15);
      border-color: #f68c1f;
      color: #ffd166;
    }

    /* Section titles */
    .pbla-section-title {
      font-size: 1.2rem;
      font-weight: 800;
      margin: 0 0 0.75rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .pbla-section-title__icon {
      font-size: 1.3rem;
    }

    /* Standings grid */
    .pbla-standings {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 0.75rem;
    }
    .pbla-team-card {
      position: relative;
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1rem 1.25rem;
      border-radius: 12px;
      background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0)), var(--bg-elev, #11151a);
      border: 1px solid var(--border);
      overflow: hidden;
      transition: transform 0.2s ease, box-shadow 0.3s ease;
      opacity: 0;
      transform: translateY(12px);
      animation: pbla-card-in 0.5s ease forwards;
    }
    .pbla-team-card:hover {
      transform: translateY(-3px);
      box-shadow: 0 6px 20px color-mix(in srgb, var(--team-color, #f68c1f) 25%, transparent);
    }
    .pbla-team-card::after {
      content: '';
      position: absolute;
      inset: auto -10% -40% auto;
      width: 140px;
      height: 140px;
      border-radius: 999px;
      background: radial-gradient(circle, color-mix(in srgb, var(--team-color, #f68c1f) 20%, transparent), transparent 70%);
      pointer-events: none;
    }
    @keyframes pbla-card-in {
      to { opacity: 1; transform: translateY(0); }
    }
    .pbla-team-card__rank {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 38px;
      min-height: 38px;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--team-color, #6b7280) 40%, transparent);
      background: color-mix(in srgb, var(--team-color, #6b7280) 12%, transparent);
      color: var(--team-color, #6b7280);
      font-weight: 800;
      font-size: 0.95rem;
    }
    .pbla-team-card__info {
      flex: 1;
      min-width: 0;
    }
    .pbla-team-card__name {
      font-weight: 700;
      font-size: 0.95rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pbla-team-card__record {
      font-size: 0.8rem;
      color: var(--muted);
      margin-top: 0.15rem;
    }
    .pbla-team-card__stats {
      display: flex;
      gap: 0.6rem;
      font-size: 0.78rem;
      color: var(--muted);
    }
    .pbla-team-card__stat {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.1rem;
    }
    .pbla-team-card__stat-val {
      font-weight: 700;
      color: #f8fafc;
      font-size: 0.9rem;
    }
    .pbla-streak {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: 999px;
      font-size: 0.7rem;
      font-weight: 700;
    }
    .pbla-streak--win {
      color: #86efac;
      background: rgba(34, 197, 94, 0.12);
    }
    .pbla-streak--loss {
      color: #fca5a5;
      background: rgba(239, 68, 68, 0.12);
    }

    /* Leaders table */
    .pbla-leaders {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    .pbla-leaders th {
      text-align: left;
      padding: 0.6rem 0.5rem;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
    }
    .pbla-leaders th:not(:first-child):not(:nth-child(2)):not(:nth-child(3)) {
      text-align: right;
    }
    .pbla-leaders td {
      padding: 0.55rem 0.5rem;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
    }
    .pbla-leaders td:not(:first-child):not(:nth-child(2)):not(:nth-child(3)) {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .pbla-leaders tr {
      opacity: 0;
      transform: translateX(-8px);
      animation: pbla-row-in 0.4s ease forwards;
    }
    @keyframes pbla-row-in {
      to { opacity: 1; transform: translateX(0); }
    }
    .pbla-leaders__rank {
      font-weight: 800;
      color: #f68c1f;
      min-width: 1.5rem;
    }
    .pbla-leaders__name {
      font-weight: 700;
    }
    .pbla-leaders__team {
      color: var(--muted);
      font-size: 0.8rem;
    }
    .pbla-leaders__pts {
      font-weight: 800;
      color: #ffd166;
    }

    /* CTA */
    .pbla-cta {
      text-align: center;
      padding: 2rem 1rem;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(246, 140, 31, 0.08), rgba(255, 209, 102, 0.04));
      border: 1px solid rgba(246, 140, 31, 0.25);
    }
    .pbla-cta__title {
      font-size: 1.1rem;
      font-weight: 800;
      margin: 0 0 0.5rem;
    }
    .pbla-cta__text {
      color: var(--muted);
      font-size: 0.9rem;
      margin: 0 0 1rem;
    }
    .pbla-cta__links {
      display: flex;
      justify-content: center;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .pbla-cta__link {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      background: rgba(246, 140, 31, 0.12);
      border: 1px solid rgba(246, 140, 31, 0.3);
      color: #ffd166;
      font-size: 0.85rem;
      font-weight: 600;
      text-decoration: none;
      transition: background 0.2s ease;
    }
    .pbla-cta__link:hover {
      background: rgba(246, 140, 31, 0.22);
    }

    /* Responsive */
    @media (max-width: 600px) {
      .pbla-hero__title { font-size: 1.5rem; }
      .pbla-standings { grid-template-columns: 1fr; }
      .pbla-team-card__stats { gap: 0.4rem; }
    }
  `;
  document.head.appendChild(style);
}

function pickColor(): number {
  return PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)] ?? PARTICLE_COLORS[0];
}

function makeParticles(w: number, h: number): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() * 0.2 + 0.04) * (Math.random() > 0.5 ? 1 : -1),
    vy: (Math.random() * 0.15 + 0.03) * (Math.random() > 0.5 ? 1 : -1),
    radius: Math.random() * 2.5 + 1.4,
    color: pickColor(),
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

  const tick = (): void => {
    if (token !== renderToken || activeApp !== app) return;
    const w = Math.max(app.screen.width, 1);
    const h = Math.max(app.screen.height, 1);
    if (particles.length === 0) particles = makeParticles(w, h);

    const delta = app.ticker.deltaTime;
    lineLayer.clear();
    particleLayer.clear();

    for (const p of particles) {
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;
    }

    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      if (!a) continue;
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        if (!b) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dSq = dx * dx + dy * dy;
        if (dSq > CONNECT_DISTANCE_SQ) continue;
        const alpha = 0.12 * (1 - dSq / CONNECT_DISTANCE_SQ);
        lineLayer.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: a.color, alpha });
      }
    }

    for (const p of particles) {
      particleLayer.circle(p.x, p.y, p.radius).fill({ color: p.color, alpha: 0.7 });
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

function sched(cb: () => void, delay: number): void {
  const t = window.setTimeout(() => {
    pendingTimers = pendingTimers.filter((v) => v !== t);
    cb();
  }, delay);
  pendingTimers.push(t);
}

function clearTimers(): void {
  for (const t of pendingTimers) window.clearTimeout(t);
  pendingTimers = [];
}

function buildStandings(teams: PblaTeam[], animate: boolean): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'pbla-standings';

  teams.forEach((team, idx) => {
    const card = document.createElement('div');
    card.className = 'pbla-team-card';
    card.style.setProperty('--team-color', team.color);
    if (animate) card.style.animationDelay = `${idx * 80}ms`;
    else card.style.animation = 'none';
    if (!animate) { card.style.opacity = '1'; card.style.transform = 'none'; }

    const streakClass = team.streak.startsWith('W') ? 'pbla-streak--win' : 'pbla-streak--loss';

    card.innerHTML = `
      <div class="pbla-team-card__rank">${idx + 1}</div>
      <div class="pbla-team-card__info">
        <div class="pbla-team-card__name">${team.name}</div>
        <div class="pbla-team-card__record">${team.wins}-${team.losses}-${team.ties} <span class="pbla-streak ${streakClass}">${team.streak}</span></div>
      </div>
      <div class="pbla-team-card__stats">
        <div class="pbla-team-card__stat"><span class="pbla-team-card__stat-val">${team.pf}</span>PF</div>
        <div class="pbla-team-card__stat"><span class="pbla-team-card__stat-val">${team.pa}</span>PA</div>
        <div class="pbla-team-card__stat"><span class="pbla-team-card__stat-val">${team.diff > 0 ? '+' : ''}${team.diff}</span>+/-</div>
      </div>
    `;
    grid.appendChild(card);
  });

  return grid;
}

function buildLeaders(players: PblaPlayer[], animate: boolean): HTMLElement {
  const table = document.createElement('table');
  table.className = 'pbla-leaders';
  table.innerHTML = `
    <thead>
      <tr style="opacity:1;transform:none;animation:none">
        <th>#</th><th>Player</th><th>Team</th><th>GP</th><th>G</th><th>A</th><th>Pts</th><th>PIM</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement('tbody');
  players.forEach((p, idx) => {
    const tr = document.createElement('tr');
    if (animate) tr.style.animationDelay = `${idx * 60 + 200}ms`;
    else { tr.style.opacity = '1'; tr.style.transform = 'none'; tr.style.animation = 'none'; }

    const teamClr = teamColor(p.team);
    tr.innerHTML = `
      <td class="pbla-leaders__rank">${idx + 1}</td>
      <td class="pbla-leaders__name">#${p.jersey} ${p.name}</td>
      <td class="pbla-leaders__team" style="color:${teamClr}">${p.team}</td>
      <td>${p.gp}</td>
      <td>${p.goals}</td>
      <td>${p.assists}</td>
      <td class="pbla-leaders__pts">${p.points}</td>
      <td>${p.pim}</td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function renderSeason(container: HTMLElement, season: PblaSeason, animate: boolean): void {
  container.replaceChildren();

  // Standings section
  const standingsTitle = document.createElement('h2');
  standingsTitle.className = 'pbla-section-title';
  standingsTitle.innerHTML = '<span class="pbla-section-title__icon">&#127942;</span> Standings';
  container.appendChild(standingsTitle);
  container.appendChild(buildStandings(season.teams, animate));

  // Leaders section
  const leadersTitle = document.createElement('h2');
  leadersTitle.className = 'pbla-section-title';
  leadersTitle.innerHTML = '<span class="pbla-section-title__icon">&#127775;</span> Scoring Leaders';
  leadersTitle.style.marginTop = '1.5rem';
  container.appendChild(leadersTitle);
  container.appendChild(buildLeaders(season.players, animate));

  // Animated counters for top 3
  if (animate && season.players.length >= 3) {
    const ptsCells = container.querySelectorAll('.pbla-leaders__pts');
    ptsCells.forEach((cell, idx) => {
      if (idx >= 3) return;
      const val = season.players[idx]?.points ?? 0;
      cell.textContent = '';
      const counter = createAutoCounter({ value: val, duration: 1200 });
      cell.appendChild(counter);
    });
  }
}

export function render(root: HTMLElement): void {
  renderToken += 1;
  const token = renderToken;
  clearTimers();

  setPageMeta({
    title: 'PBLA Box Lacrosse - PhillyLaxStats',
    description: 'Philadelphia Box Lacrosse Association stats, standings, and scoring leaders.',
  });

  ensureStyles();

  let selectedIdx = 0;

  root.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'pbla-root';

  // WebGL background
  const webglHost = document.createElement('div');
  webglHost.className = 'pbla-webgl';
  wrapper.appendChild(webglHost);

  // Shell
  const shell = document.createElement('div');
  shell.className = 'pbla-shell';

  // Hero
  const hero = document.createElement('div');
  hero.className = 'pbla-hero';
  hero.innerHTML = `
    <div class="pbla-hero__badge">Partnership Demo</div>
    <h1 class="pbla-hero__title">Philadelphia Box Lacrosse Association</h1>
    <p class="pbla-hero__subtitle">Oldest active box lacrosse league in the US - Est. 1986</p>
  `;
  shell.appendChild(hero);

  // Season selector
  const seasonBar = document.createElement('div');
  seasonBar.className = 'pbla-season-bar';
  SEASONS.forEach((s, idx) => {
    const btn = document.createElement('button');
    btn.className = `pbla-season-btn${idx === selectedIdx ? ' pbla-season-btn--active' : ''}`;
    btn.textContent = s.label;
    btn.addEventListener('click', () => {
      if (token !== renderToken) return;
      selectedIdx = idx;
      seasonBar.querySelectorAll('.pbla-season-btn').forEach((b, i) => {
        b.classList.toggle('pbla-season-btn--active', i === idx);
      });
      renderSeason(seasonContent, SEASONS[idx]!, shouldAnimate());
    });
    seasonBar.appendChild(btn);
  });
  shell.appendChild(seasonBar);

  // Season content container
  const seasonContent = document.createElement('div');
  shell.appendChild(seasonContent);

  // CTA
  const cta = document.createElement('div');
  cta.className = 'pbla-cta';
  cta.innerHTML = `
    <h3 class="pbla-cta__title">Interested in a stats partnership?</h3>
    <p class="pbla-cta__text">We can bring real-time stats, player profiles, and interactive visualizations to the PBLA community.</p>
    <div class="pbla-cta__links">
      <a class="pbla-cta__link" href="https://phillyboxlacrosse.org/" target="_blank" rel="noopener noreferrer">PBLA Website &#8599;</a>
      <a class="pbla-cta__link" href="https://secure.sportability.com/spx/Leagues/League.asp?LgID=50731" target="_blank" rel="noopener noreferrer">Live Stats &#8599;</a>
      <a class="pbla-cta__link" href="https://www.youtube.com/@pbla-tv" target="_blank" rel="noopener noreferrer">PBLA-TV &#8599;</a>
    </div>
  `;
  shell.appendChild(cta);

  wrapper.appendChild(shell);
  root.appendChild(wrapper);

  // Render initial season
  renderSeason(seasonContent, SEASONS[selectedIdx]!, shouldAnimate());

  // Mount WebGL
  if (shouldMountWebGL()) {
    sched(() => {
      if (token !== renderToken) return;
      mountWebGL(webglHost, token);
    }, 100);
  }
}

export function destroy(): void {
  renderToken += 1;
  clearTimers();
  destroyWebGL();
}
