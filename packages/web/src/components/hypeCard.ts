import { Application, Graphics } from 'pixi.js';
import { createAnimatedCounter, type CounterOptions } from './animatedCounter.js';

export interface HypePlayerData {
  playerName: string;
  teamName: string;
  teamLogoUrl?: string;
  statLabel: string;
  statValue: number;
  secondaryStat?: { label: string; value: number };
  playerHref: string;
}

export interface HypeCardHandle {
  destroy: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: number;
  driftVx: number;
  driftVy: number;
}

const CARD_BG = '#0e1119';
const PARTICLE_BG = 0x0e1119;
const PARTICLE_COLORS = [0xffd166, 0xff6b6b, 0x4ea1ff] as const;
const CONNECT_DISTANCE = 80;
const MIN_PARTICLES = 36;
const MAX_PARTICLES = 44;
const LOOP_BURST_MS = 4000;

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pickColor(): number {
  const idx = Math.floor(Math.random() * PARTICLE_COLORS.length);
  return PARTICLE_COLORS[idx] ?? PARTICLE_COLORS[0];
}

function createBurstParticle(originX: number, originY: number): Particle {
  const angle = randomBetween(-0.9, 0.9);
  const speed = randomBetween(2, 5);
  return {
    x: originX,
    y: originY,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius: randomBetween(1.5, 4),
    color: pickColor(),
    driftVx: (Math.random() < 0.5 ? -1 : 1) * randomBetween(0.2, 0.4),
    driftVy: (Math.random() < 0.5 ? -1 : 1) * randomBetween(0.2, 0.4),
  };
}

function createEdgeBurstParticle(width: number, height: number): Particle {
  const edge = Math.floor(Math.random() * 4);
  if (edge === 0) return createBurstParticle(randomBetween(0, width), 0);
  if (edge === 1) return createBurstParticle(width, randomBetween(0, height));
  if (edge === 2) return createBurstParticle(randomBetween(0, width), height);
  return createBurstParticle(0, randomBetween(0, height));
}

function updateParticle(particle: Particle, width: number, height: number): void {
  const speed = Math.hypot(particle.vx, particle.vy);
  if (speed >= 0.1) {
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.vx *= 0.97;
    particle.vy *= 0.97;
  } else {
    particle.x += particle.driftVx + randomBetween(-0.08, 0.08);
    particle.y += particle.driftVy + randomBetween(-0.08, 0.08);
  }

  if (particle.x < -12) particle.x = width + 12;
  if (particle.x > width + 12) particle.x = -12;
  if (particle.y < -12) particle.y = height + 12;
  if (particle.y > height + 12) particle.y = -12;
}

function drawParticles(graphics: Graphics, particles: Particle[]): void {
  graphics.clear();

  for (let i = 0; i < particles.length; i += 1) {
    const a = particles[i];
    if (!a) continue;
    for (let j = i + 1; j < particles.length; j += 1) {
      const b = particles[j];
      if (!b) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distance = Math.hypot(dx, dy);
      if (distance > CONNECT_DISTANCE) continue;
      const alpha = 0.1 * (1 - distance / CONNECT_DISTANCE);
      graphics.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: 0xffffff, alpha });
    }
  }

  for (const particle of particles) {
    graphics.circle(particle.x, particle.y, particle.radius).fill({ color: particle.color, alpha: 0.9 });
  }
}

function buildStatCounter(data: HypePlayerData, accent: string): { row: HTMLElement; counter: ReturnType<typeof createAnimatedCounter> } {
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.alignItems = 'baseline';
  row.style.gap = '0.75rem';
  row.style.flexWrap = 'wrap';

  const counterOptions: CounterOptions = {
    value: data.statValue,
    duration: 1500,
  };
  const counter = createAnimatedCounter(counterOptions);
  counter.el.style.fontSize = '1.5rem';
  counter.el.style.fontWeight = '800';
  counter.el.style.lineHeight = '1';
  counter.el.style.color = accent;

  const label = document.createElement('span');
  label.textContent = data.statLabel;
  label.style.fontSize = '0.95rem';
  label.style.fontWeight = '600';
  label.style.color = '#e5e7eb';

  row.append(counter.el, label);
  return { row, counter };
}

function buildTeamLine(data: HypePlayerData): HTMLElement {
  const teamLine = document.createElement('div');
  teamLine.style.display = 'inline-flex';
  teamLine.style.alignItems = 'center';
  teamLine.style.gap = '0.5rem';
  teamLine.style.fontSize = '0.85rem';
  teamLine.style.color = '#9ca3af';

  if (data.teamLogoUrl) {
    const logo = document.createElement('img');
    // teamLogoUrl may already be prefixed with /logos/ from the API
    logo.src = data.teamLogoUrl.startsWith('/') ? data.teamLogoUrl : `/logos/${data.teamLogoUrl}`;
    logo.alt = `${data.teamName} logo`;
    logo.width = 24;
    logo.height = 24;
    logo.loading = 'lazy';
    logo.decoding = 'async';
    logo.style.width = '24px';
    logo.style.height = '24px';
    logo.style.objectFit = 'contain';
    logo.style.borderRadius = '999px';
    logo.style.flex = '0 0 24px';
    teamLine.appendChild(logo);
  }

  const text = document.createElement('span');
  text.textContent = data.teamName;
  teamLine.appendChild(text);
  return teamLine;
}

function applyWrapperStyles(anchor: HTMLAnchorElement, accent: string): void {
  anchor.style.position = 'relative';
  anchor.style.display = 'block';
  anchor.style.overflow = 'hidden';
  anchor.style.borderRadius = '12px';
  anchor.style.padding = '1rem 1.25rem';
  anchor.style.minHeight = '120px';
  anchor.style.height = '100%';
  anchor.style.boxSizing = 'border-box';
  anchor.style.background = CARD_BG;
  anchor.style.textDecoration = 'none';
  anchor.style.boxShadow = '0 12px 30px rgba(0, 0, 0, 0.3)';
  anchor.style.border = `1px solid ${accent}33`;
}

function buildCanvasHost(): HTMLDivElement {
  const stage = document.createElement('div');
  stage.setAttribute('aria-hidden', 'true');
  stage.style.position = 'absolute';
  stage.style.inset = '0';
  stage.style.zIndex = '0';
  stage.style.pointerEvents = 'none';
  return stage;
}

function buildContent(data: HypePlayerData, kicker: string, accent: string): { content: HTMLDivElement; counter: ReturnType<typeof createAnimatedCounter> } {
  const content = document.createElement('div');
  content.style.position = 'relative';
  content.style.zIndex = '1';
  content.style.display = 'flex';
  content.style.flexDirection = 'column';
  content.style.gap = '0.5rem';
  content.style.maxWidth = '32rem';

  const kickerEl = document.createElement('div');
  kickerEl.textContent = kicker;
  kickerEl.style.color = accent;
  kickerEl.style.fontWeight = '700';
  kickerEl.style.fontSize = '0.7rem';
  kickerEl.style.textTransform = 'uppercase';
  kickerEl.style.letterSpacing = '0.05em';

  const playerName = document.createElement('div');
  playerName.textContent = data.playerName;
  playerName.style.fontSize = '1.1rem';
  playerName.style.fontWeight = '800';
  playerName.style.color = '#e5e7eb';
  playerName.style.lineHeight = '1.2';

  const teamLine = buildTeamLine(data);
  const { row: statRow, counter } = buildStatCounter(data, accent);

  content.append(kickerEl, playerName, teamLine, statRow);

  if (data.secondaryStat) {
    const secondary = document.createElement('div');
    secondary.textContent = `${data.secondaryStat.value} ${data.secondaryStat.label}`;
    secondary.style.fontSize = '0.9rem';
    secondary.style.fontWeight = '600';
    secondary.style.color = '#cbd5e1';
    content.appendChild(secondary);
  }

  return { content, counter };
}

async function initPixi(stage: HTMLDivElement): Promise<Application | null> {
  const width = Math.max(320, Math.round(stage.clientWidth || stage.parentElement?.clientWidth || 640));
  const height = Math.max(160, Math.round(stage.clientHeight || stage.parentElement?.clientHeight || 160));

  const app = new Application();
  await app.init({
    background: PARTICLE_BG,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio ?? 1, 2),
    autoDensity: true,
    width,
    height,
  });

  if (!document.body.contains(stage)) {
    app.destroy(true, { children: true });
    return null;
  }

  app.canvas.style.width = '100%';
  app.canvas.style.height = '100%';
  stage.appendChild(app.canvas);
  return app;
}

export interface HypeCardOptions {
  kicker?: string;
  accentColor?: string;
}

/**
 * Renders a featured hype card with:
 * - Pixi.js particle burst background (energetic sparks)
 * - Name, subtitle, and stat with animated counter
 * - Clickable link to detail page
 */
export function mountHypeCard(container: HTMLElement, data: HypePlayerData, options?: HypeCardOptions): HypeCardHandle {
  container.innerHTML = '';
  const accent = options?.accentColor ?? '#ffd166';
  const kicker = options?.kicker ?? '\uD83D\uDD25 Player of the Week';

  const anchor = document.createElement('a');
  anchor.href = data.playerHref;
  anchor.setAttribute('aria-label', `View ${data.playerName} details`);
  applyWrapperStyles(anchor, accent);

  const stage = buildCanvasHost();
  const { content, counter } = buildContent(data, kicker, accent);
  anchor.append(stage, content);
  container.appendChild(anchor);

  let app: Application | null = null;
  let destroyed = false;
  const particles: Particle[] = [];
  let nextBurstAt = performance.now() + LOOP_BURST_MS;

  const width = () => Math.max(320, Math.round(stage.clientWidth || anchor.clientWidth || 640));
  const height = () => Math.max(160, Math.round(stage.clientHeight || anchor.clientHeight || 160));
  const seedOrigin = (): { x: number; y: number } => ({
    x: width() * 0.34,
    y: height() * 0.5,
  });

  for (let i = 0; i < MIN_PARTICLES; i += 1) {
    const origin = seedOrigin();
    particles.push(createBurstParticle(origin.x, origin.y));
  }

  const counterTimer = window.setTimeout(() => {
    if (!destroyed) counter.start();
  }, 200);

  void initPixi(stage).then((initializedApp) => {
    if (!initializedApp) return;
    if (destroyed) {
      initializedApp.destroy(true, { children: true });
      return;
    }

    app = initializedApp;
    const graphics = new Graphics();
    initializedApp.stage.addChild(graphics);

    initializedApp.ticker.add(() => {
      const now = performance.now();
      const currentWidth = width();
      const currentHeight = height();

      if (initializedApp.renderer.width !== currentWidth || initializedApp.renderer.height !== currentHeight) {
        initializedApp.renderer.resize(currentWidth, currentHeight);
      }

      if (now >= nextBurstAt) {
        const additions = Math.round(randomBetween(5, 8));
        for (let i = 0; i < additions; i += 1) {
          particles.push(createEdgeBurstParticle(currentWidth, currentHeight));
        }
        nextBurstAt = now + LOOP_BURST_MS;
      }

      while (particles.length > MAX_PARTICLES) particles.shift();
      for (const particle of particles) updateParticle(particle, currentWidth, currentHeight);
      drawParticles(graphics, particles);
    });
  });

  return {
    destroy: () => {
      destroyed = true;
      window.clearTimeout(counterTimer);
      if (app) {
        app.destroy(true, { children: true });
        app = null;
      }
      container.innerHTML = '';
    },
  };
}
