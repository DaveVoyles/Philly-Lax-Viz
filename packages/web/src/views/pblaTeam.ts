import { Application, Graphics } from 'pixi.js';
import { shouldAnimate, shouldMountWebGL } from '../util/motionPrefs.js';
import { createAutoCounter } from '../components/animatedCounter.js';
import { setPageMeta } from '../util/pageMeta.js';
import {
  SEASONS,
  teamColor,
  teamSlug,
  findTeamBySlug,
  getTeamPlayers,
  getTeamGoalies,
  getTeamRoster,
  type PblaSeason,
  type PblaTeam,
  type PblaPlayer,
  type PblaGoalie,
  type PblaRosterEntry,
} from './pblaData.js';

const STYLE_ID = 'pbla-team-view-styles';
const PARTICLE_COUNT = 35;
const CONNECT_DISTANCE = 100;
const CONNECT_DISTANCE_SQ = CONNECT_DISTANCE * CONNECT_DISTANCE;

interface Particle {
  x: number; y: number; vx: number; vy: number; radius: number; color: number;
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
    .pbla-team-root {
      position: relative;
      isolation: isolate;
      padding-bottom: 2rem;
    }
    .pbla-team-webgl {
      position: absolute;
      inset: 0;
      z-index: -1;
      pointer-events: none;
      overflow: hidden;
    }
    .pbla-team-shell {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    /* Back link */
    .pbla-team-back {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      color: var(--muted);
      font-size: 0.85rem;
      text-decoration: none;
      transition: color 0.2s;
    }
    .pbla-team-back:hover { color: #f68c1f; }

    /* Hero header */
    .pbla-team-hero {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      padding: 1.5rem;
      border-radius: 12px;
      background: linear-gradient(135deg, color-mix(in srgb, var(--team-accent) 8%, transparent), transparent);
      border: 1px solid color-mix(in srgb, var(--team-accent) 30%, var(--border));
    }
    .pbla-team-hero__emblem {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 64px;
      height: 64px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--team-accent) 15%, transparent);
      border: 2px solid var(--team-accent);
      font-size: 1.8rem;
      font-weight: 900;
      color: var(--team-accent);
    }
    .pbla-team-hero__info { flex: 1; }
    .pbla-team-hero__name {
      font-size: 1.6rem;
      font-weight: 900;
      margin: 0;
      color: var(--team-accent);
    }
    .pbla-team-hero__meta {
      color: var(--muted);
      font-size: 0.9rem;
      margin: 0.25rem 0 0;
    }

    /* Stat cards */
    .pbla-team-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
      gap: 0.75rem;
    }
    .pbla-team-stat {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 1rem 0.5rem;
      border-radius: 10px;
      background: var(--bg-elev, #11151a);
      border: 1px solid var(--border);
      opacity: 0;
      transform: translateY(10px);
      animation: pbla-stat-in 0.4s ease forwards;
    }
    @keyframes pbla-stat-in { to { opacity: 1; transform: translateY(0); } }
    .pbla-team-stat__val {
      font-size: 1.4rem;
      font-weight: 800;
      color: var(--team-accent);
    }
    .pbla-team-stat__label {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      margin-top: 0.2rem;
    }

    /* Season selector */
    .pbla-team-season-bar {
      display: flex;
      gap: 0.5rem;
    }
    .pbla-team-season-btn {
      padding: 0.4rem 0.9rem;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--muted);
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .pbla-team-season-btn--active {
      background: color-mix(in srgb, var(--team-accent) 15%, transparent);
      border-color: var(--team-accent);
      color: var(--team-accent);
    }

    /* Section */
    .pbla-team-section-title {
      font-size: 1.1rem;
      font-weight: 800;
      margin: 0.5rem 0 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }

    /* Roster table */
    .pbla-team-roster {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    .pbla-team-roster th {
      text-align: left;
      padding: 0.55rem 0.5rem;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
    }
    .pbla-team-roster th:not(:first-child):not(:nth-child(2)) { text-align: right; }
    .pbla-team-roster td {
      padding: 0.5rem 0.5rem;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
    }
    .pbla-team-roster td:not(:first-child):not(:nth-child(2)) {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .pbla-team-roster tr {
      opacity: 0;
      transform: translateX(-6px);
      animation: pbla-roster-in 0.35s ease forwards;
    }
    @keyframes pbla-roster-in { to { opacity: 1; transform: translateX(0); } }
    .pbla-team-roster__jersey {
      font-weight: 800;
      color: var(--team-accent);
      min-width: 2rem;
    }
    .pbla-team-roster__name { font-weight: 700; }
    .pbla-team-roster__pts { font-weight: 800; color: #ffd166; }

    /* Empty state */
    .pbla-team-empty {
      padding: 2rem;
      text-align: center;
      color: var(--muted);
      font-size: 0.9rem;
      border: 1px dashed var(--border);
      border-radius: 10px;
    }

    @media (max-width: 600px) {
      .pbla-team-hero { flex-direction: column; text-align: center; gap: 0.75rem; }
      .pbla-team-hero__name { font-size: 1.3rem; }
      .pbla-team-stats { grid-template-columns: repeat(3, 1fr); }
    }
  `;
  document.head.appendChild(style);
}

function mountWebGL(host: HTMLElement, token: number, color: number): void {
  destroyWebGL();
  activeHost = host;
  host.replaceChildren();

  const stage = document.createElement('div');
  stage.style.position = 'absolute';
  stage.style.inset = '0';
  host.appendChild(stage);

  const colors = [color, 0xf8fafc, 0x64748b];

  const app = new Application();
  activeApp = app;
  const lineLayer = new Graphics();
  const particleLayer = new Graphics();
  let particles: Particle[] = [];

  const makeParticles = (w: number, h: number): Particle[] =>
    Array.from({ length: PARTICLE_COUNT }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() * 0.18 + 0.03) * (Math.random() > 0.5 ? 1 : -1),
      vy: (Math.random() * 0.12 + 0.02) * (Math.random() > 0.5 ? 1 : -1),
      radius: Math.random() * 2.2 + 1.2,
      color: colors[Math.floor(Math.random() * colors.length)]!,
    }));

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
        const alpha = 0.1 * (1 - dSq / CONNECT_DISTANCE_SQ);
        lineLayer.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: a.color, alpha });
      }
    }

    for (const p of particles) {
      particleLayer.circle(p.x, p.y, p.radius).fill({ color: p.color, alpha: 0.6 });
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

function hexToPixi(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

function buildRosterTable(players: PblaPlayer[], animate: boolean): HTMLElement {
  if (players.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pbla-team-empty';
    empty.textContent = 'No player stats available for this team yet.';
    return empty;
  }

  const sorted = [...players].sort((a, b) => b.points - a.points);
  const table = document.createElement('table');
  table.className = 'pbla-team-roster';
  table.innerHTML = `
    <thead>
      <tr style="opacity:1;transform:none;animation:none">
        <th>#</th><th>Player</th><th>GP</th><th>G</th><th>A</th><th>Pts</th><th>PIM</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement('tbody');
  sorted.forEach((p, idx) => {
    const tr = document.createElement('tr');
    if (animate) tr.style.animationDelay = `${idx * 50 + 100}ms`;
    else { tr.style.opacity = '1'; tr.style.transform = 'none'; tr.style.animation = 'none'; }
    tr.innerHTML = `
      <td class="pbla-team-roster__jersey">${p.jersey}</td>
      <td class="pbla-team-roster__name">${p.name}</td>
      <td>${p.gp}</td>
      <td>${p.goals}</td>
      <td>${p.assists}</td>
      <td class="pbla-team-roster__pts">${p.points}</td>
      <td>${p.pim}</td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function buildFullRosterTable(roster: PblaRosterEntry[], animate: boolean): HTMLElement {
  const table = document.createElement('table');
  table.className = 'pbla-team-roster';
  table.innerHTML = `
    <thead>
      <tr style="opacity:1;transform:none;animation:none">
        <th>#</th><th>Player</th><th>Pos</th><th>Notes</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement('tbody');
  roster.forEach((p, idx) => {
    const tr = document.createElement('tr');
    if (animate) tr.style.animationDelay = `${idx * 40 + 100}ms`;
    else { tr.style.opacity = '1'; tr.style.transform = 'none'; tr.style.animation = 'none'; }
    tr.innerHTML = `
      <td class="pbla-team-roster__jersey">${p.jersey || '-'}</td>
      <td class="pbla-team-roster__name">${p.name}</td>
      <td>${p.position || '-'}</td>
      <td>${p.notes || ''}</td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function buildGoalieTable(goalies: PblaGoalie[], animate: boolean): HTMLElement {
  if (goalies.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pbla-team-empty';
    empty.textContent = 'No goalie stats available for this team yet.';
    return empty;
  }

  const table = document.createElement('table');
  table.className = 'pbla-team-roster';
  table.innerHTML = `
    <thead>
      <tr style="opacity:1;transform:none;animation:none">
        <th>#</th><th>Goalie</th><th>GP</th><th>Min</th><th>GA</th><th>GAA</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement('tbody');
  goalies.forEach((g, idx) => {
    const tr = document.createElement('tr');
    if (animate) tr.style.animationDelay = `${idx * 50 + 100}ms`;
    else { tr.style.opacity = '1'; tr.style.transform = 'none'; tr.style.animation = 'none'; }
    tr.innerHTML = `
      <td class="pbla-team-roster__jersey">${g.jersey}</td>
      <td class="pbla-team-roster__name">${g.name}</td>
      <td>${g.gp}</td>
      <td>${g.min}</td>
      <td>${g.ga}</td>
      <td>${g.gaa.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function renderTeamContent(
  container: HTMLElement,
  team: PblaTeam,
  season: PblaSeason,
  animate: boolean,
): void {
  container.replaceChildren();

  // Stat cards
  const stats = document.createElement('div');
  stats.className = 'pbla-team-stats';
  const statItems = [
    { val: `${team.wins}-${team.losses}-${team.ties}`, label: 'Record' },
    { val: String(team.pts), label: 'Points' },
    { val: String(team.pf), label: 'Goals For' },
    { val: String(team.pa), label: 'Goals Against' },
    { val: `${team.diff > 0 ? '+' : ''}${team.diff}`, label: 'Diff' },
    { val: team.streak, label: 'Streak' },
  ];
  statItems.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'pbla-team-stat';
    if (animate) card.style.animationDelay = `${idx * 60}ms`;
    else { card.style.opacity = '1'; card.style.transform = 'none'; card.style.animation = 'none'; }
    card.innerHTML = `
      <span class="pbla-team-stat__val">${item.val}</span>
      <span class="pbla-team-stat__label">${item.label}</span>
    `;
    stats.appendChild(card);
  });
  container.appendChild(stats);

  // Players
  const playersTitle = document.createElement('h3');
  playersTitle.className = 'pbla-team-section-title';
  playersTitle.innerHTML = '&#127941; Roster Stats';
  container.appendChild(playersTitle);

  const players = getTeamPlayers(team.name, season);
  container.appendChild(buildRosterTable(players, animate));

  // Goalies
  const goalies = getTeamGoalies(team.name, season);
  if (goalies.length > 0) {
    const goalieTitle = document.createElement('h3');
    goalieTitle.className = 'pbla-team-section-title';
    goalieTitle.innerHTML = '&#129354; Goalies';
    container.appendChild(goalieTitle);
    container.appendChild(buildGoalieTable(goalies, animate));
  }

  // Full Roster
  const roster = getTeamRoster(team.name, season);
  if (roster.length > 0) {
    const rosterTitle = document.createElement('h3');
    rosterTitle.className = 'pbla-team-section-title';
    rosterTitle.innerHTML = '&#128101; Full Roster (' + roster.length + ' players)';
    container.appendChild(rosterTitle);
    container.appendChild(buildFullRosterTable(roster, animate));
  }

  // Animated counters for PF/PA
  if (animate) {
    const valEls = stats.querySelectorAll('.pbla-team-stat__val');
    [2, 3].forEach((idx) => {
      const el = valEls[idx];
      if (!el) return;
      const numVal = idx === 2 ? team.pf : team.pa;
      el.textContent = '';
      el.appendChild(createAutoCounter({ value: numVal, duration: 1000 }));
    });
  }
}

export function render(root: HTMLElement, params: Record<string, string>): void {
  renderToken += 1;
  const token = renderToken;
  clearTimers();
  ensureStyles();

  const slug = params.slug ?? '';
  const result = findTeamBySlug(slug);

  if (!result) {
    root.innerHTML = `<div class="pbla-team-empty">
      <p>Team not found.</p>
      <a href="#/pbla" class="pbla-team-back">&#8592; Back to PBLA</a>
    </div>`;
    return;
  }

  let { team, season } = result;
  setPageMeta({
    title: `${team.name} - PBLA Box Lacrosse`,
    description: `${team.name} stats and roster for the Philadelphia Box Lacrosse Association.`,
  });

  root.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'pbla-team-root';
  wrapper.style.setProperty('--team-accent', team.color);

  // WebGL
  const webglHost = document.createElement('div');
  webglHost.className = 'pbla-team-webgl';
  wrapper.appendChild(webglHost);

  // Shell
  const shell = document.createElement('div');
  shell.className = 'pbla-team-shell';

  // Back link
  const back = document.createElement('a');
  back.href = '#/pbla';
  back.className = 'pbla-team-back';
  back.innerHTML = '&#8592; Back to PBLA';
  shell.appendChild(back);

  // Hero
  const hero = document.createElement('div');
  hero.className = 'pbla-team-hero';
  const initials = team.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  hero.innerHTML = `
    <div class="pbla-team-hero__emblem">${initials}</div>
    <div class="pbla-team-hero__info">
      <h1 class="pbla-team-hero__name">${team.name}</h1>
      <p class="pbla-team-hero__meta">PBLA ${season.label} - ${team.gp} games played</p>
    </div>
  `;
  shell.appendChild(hero);

  // Season selector (show if team exists in multiple seasons)
  const teamSeasons = SEASONS.filter((s) => s.teams.some((t) => teamSlug(t.name) === slug));
  if (teamSeasons.length > 1) {
    const bar = document.createElement('div');
    bar.className = 'pbla-team-season-bar';
    teamSeasons.forEach((s) => {
      const btn = document.createElement('button');
      btn.className = `pbla-team-season-btn${s === season ? ' pbla-team-season-btn--active' : ''}`;
      btn.textContent = s.label;
      btn.addEventListener('click', () => {
        if (token !== renderToken) return;
        const newTeam = s.teams.find((t) => teamSlug(t.name) === slug);
        if (!newTeam) return;
        team = newTeam;
        season = s;
        bar.querySelectorAll('.pbla-team-season-btn').forEach((b, i) => {
          b.classList.toggle('pbla-team-season-btn--active', teamSeasons[i] === s);
        });
        renderTeamContent(content, team, season, shouldAnimate());
      });
      bar.appendChild(btn);
    });
    shell.appendChild(bar);
  }

  // Content
  const content = document.createElement('div');
  shell.appendChild(content);

  wrapper.appendChild(shell);
  root.appendChild(wrapper);

  renderTeamContent(content, team, season, shouldAnimate());

  // WebGL
  if (shouldMountWebGL()) {
    sched(() => {
      if (token !== renderToken) return;
      mountWebGL(webglHost, token, hexToPixi(team.color));
    }, 100);
  }
}

export function destroy(): void {
  renderToken += 1;
  clearTimers();
  destroyWebGL();
}
