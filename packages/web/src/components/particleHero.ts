import { Application, Container, Graphics } from 'pixi.js';

export interface ParticleHeroHandle {
  destroy: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: number;
  pulseElapsedMs: number;
  pulseDurationMs: number;
}

const BG_COLOR = 0x0e1119;
const HERO_HEIGHT = 220;
const CONNECT_DISTANCE = 120;
const CONNECT_DISTANCE_SQ = CONNECT_DISTANCE * CONNECT_DISTANCE;
const PARTICLE_COLORS = [0x4ea1ff, 0x60a5fa, 0xffd166, 0x34d399] as const;

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pickColor(): number {
  const index = Math.floor(Math.random() * PARTICLE_COLORS.length);
  return PARTICLE_COLORS[index] ?? PARTICLE_COLORS[0];
}

function wrap(value: number, max: number): number {
  if (max <= 0) return 0;
  const result = value % max;
  return result < 0 ? result + max : result;
}

function pulseScale(particle: Particle): number {
  if (particle.pulseElapsedMs >= particle.pulseDurationMs) return 1;
  const progress = particle.pulseElapsedMs / particle.pulseDurationMs;
  return 1 + Math.sin(progress * Math.PI);
}

/**
 * Mounts a full-width Pixi.js canvas (height ~220px) into `container`.
 * Renders drifting particles with faint connecting lines - sporty/energetic feel.
 * Parallax: particles shift slightly on scroll.
 */
export function mountParticleHero(container: HTMLElement): ParticleHeroHandle {
  container.innerHTML = '';
  container.style.position = 'relative';
  container.style.overflow = 'hidden';
  container.style.borderRadius = '12px';
  container.style.marginBottom = '1.5rem';
  container.style.background = '#0e1119';

  const stageHost = document.createElement('div');
  stageHost.style.width = '100%';
  stageHost.style.height = `${HERO_HEIGHT}px`;
  stageHost.style.position = 'relative';
  stageHost.style.background = '#0e1119';
  container.appendChild(stageHost);

  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  overlay.style.left = '0';
  overlay.style.right = '0';
  overlay.style.bottom = '0';
  overlay.style.height = '72px';
  overlay.style.pointerEvents = 'none';
  overlay.style.background = 'linear-gradient(to bottom, transparent 60%, var(--bg) 100%)';
  container.appendChild(overlay);

  const root = new Container();
  const lineLayer = new Graphics();
  const particleLayer = new Graphics();
  root.addChild(lineLayer);
  root.addChild(particleLayer);

  const particleCount = Math.floor(randomBetween(60, 81));
  const particles: Particle[] = Array.from({ length: particleCount }, () => ({
    x: randomBetween(0, Math.max(stageHost.clientWidth || container.clientWidth || 1, 1)),
    y: randomBetween(0, HERO_HEIGHT),
    vx: (Math.random() < 0.5 ? -1 : 1) * randomBetween(0.3, 1.2),
    vy: (Math.random() < 0.5 ? -1 : 1) * randomBetween(0.08, 0.45),
    radius: randomBetween(2, 4),
    color: pickColor(),
    pulseElapsedMs: Number.POSITIVE_INFINITY,
    pulseDurationMs: 500,
  }));

  let destroyed = false;
  let currentScrollY = window.scrollY;
  let pulseTimerMs = randomBetween(2400, 3400);

  const app = new Application();

  const handleScroll = (): void => {
    currentScrollY = window.scrollY;
  };

  const tick = (): void => {
    const delta = app.ticker.deltaTime;
    const deltaMs = app.ticker.deltaMS;
    const width = app.screen.width;
    const height = app.screen.height;
    const parallaxOffset = currentScrollY * 0.05;

    pulseTimerMs -= deltaMs;
    if (pulseTimerMs <= 0 && particles.length > 0) {
      const target = particles[Math.floor(Math.random() * particles.length)];
      if (target) target.pulseElapsedMs = 0;
      pulseTimerMs = randomBetween(2600, 3400);
    }

    for (const particle of particles) {
      particle.x = wrap(particle.x + particle.vx * delta, width);
      particle.y = wrap(particle.y + particle.vy * delta, height);
      if (particle.pulseElapsedMs < particle.pulseDurationMs) {
        particle.pulseElapsedMs += deltaMs;
      }
    }

    lineLayer.clear();
    particleLayer.clear();

    for (let i = 0; i < particles.length; i += 1) {
      const a = particles[i];
      if (!a) continue;
      const ax = wrap(a.x, width);
      const ay = wrap(a.y + parallaxOffset, height);

      for (let j = i + 1; j < particles.length; j += 1) {
        const b = particles[j];
        if (!b) continue;
        const bx = wrap(b.x, width);
        const by = wrap(b.y + parallaxOffset, height);
        const dx = ax - bx;
        const dy = ay - by;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq > CONNECT_DISTANCE_SQ) continue;
        const alpha = 0.15 * (1 - distanceSq / CONNECT_DISTANCE_SQ);
        lineLayer.moveTo(ax, ay).lineTo(bx, by).stroke({ width: 1, color: a.color, alpha });
      }
    }

    for (const particle of particles) {
      const px = wrap(particle.x, width);
      const py = wrap(particle.y + parallaxOffset, height);
      const scale = pulseScale(particle);
      particleLayer.circle(px, py, particle.radius * scale).fill({ color: particle.color, alpha: 0.9 });
    }
  };

  void app.init({
    background: BG_COLOR,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio ?? 1, 2),
    autoDensity: true,
    resizeTo: stageHost,
  }).then(() => {
    if (destroyed) {
      app.destroy(true, { children: true });
      return;
    }

    app.stage.addChild(root);
    app.canvas.style.borderRadius = '12px';
    app.canvas.style.display = 'block';
    app.canvas.style.width = '100%';
    app.canvas.style.height = `${HERO_HEIGHT}px`;
    stageHost.appendChild(app.canvas);

    window.addEventListener('scroll', handleScroll, { passive: true });
    app.ticker.add(tick);
    handleScroll();
    tick();
  });

  return {
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener('scroll', handleScroll);
      app.ticker.remove(tick);
      app.destroy(true, { children: true });
      container.innerHTML = '';
    },
  };
}
