import { Application, Graphics } from 'pixi.js';

const PARTICLE_COUNT = 64;
const CONNECT_DISTANCE = 148;
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
let pendingTimers: number[] = [];
let activeBurst: ((x: number, y: number, color: number) => void) | null = null;
let cleanupFns: Array<() => void> = [];

export function nextRenderToken(): number {
  renderToken += 1;
  return renderToken;
}

export function invalidateRenderToken(): void {
  renderToken += 1;
}

export function isCurrentRenderToken(token: number): boolean {
  return token === renderToken;
}

export function registerCleanup(fn: () => void): void {
  cleanupFns.push(fn);
}

export function burstAt(x: number, y: number, color: number, token: number): void {
  if (!activeBurst || token !== renderToken) return;
  activeBurst(x, y, color);
}

export function schedule(callback: () => void, delay: number): void {
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

export { clearCleanup, clearPendingTimers, clearScopedCleanup, destroyWebGL, mountWebGL };
