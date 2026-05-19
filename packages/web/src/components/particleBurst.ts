export interface ParticleBurstOptions {
  /** Number of particles (default 30) */
  count?: number;
  /** Colors to randomly pick from */
  colors?: string[];
  /** Duration in ms (default 1500) */
  duration?: number;
  /** Particle radius range [min, max] (default [2, 5]) */
  radiusRange?: [number, number];
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  opacity: number;
  fadeRate: number;
}

const DEFAULT_COLORS = ['#fbbf24', '#f97316', '#ffffff'];
const DEFAULT_DURATION = 1500;
const DEFAULT_COUNT = 30;
const DEFAULT_RADIUS_RANGE: [number, number] = [2, 5];
const FRAME_MS = 1000 / 60;
const GRAVITY = 0.1;

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pickOne<T>(items: ReadonlyArray<T>): T {
  const index = Math.floor(Math.random() * items.length);
  return items[index] ?? items[0]!;
}

function clampFrameDelta(deltaMs: number): number {
  return Math.max(0.5, Math.min(3, deltaMs / FRAME_MS));
}

/**
 * Creates a brief particle burst animation overlaid on the target element.
 * The canvas auto-removes after the animation completes.
 * Returns a cleanup function in case the view is destroyed early.
 */
export function triggerParticleBurst(
  target: HTMLElement,
  options: ParticleBurstOptions = {},
): () => void {
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return () => undefined;
  }

  const count = options.count ?? DEFAULT_COUNT;
  const duration = options.duration ?? DEFAULT_DURATION;
  const colors = options.colors?.length ? options.colors : DEFAULT_COLORS;
  const radiusRange = options.radiusRange ?? DEFAULT_RADIUS_RANGE;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '1';
  canvas.style.borderRadius = 'inherit';

  const context = canvas.getContext('2d');
  if (!context) {
    return () => undefined;
  }

  const previousPosition = target.style.position;
  const computedPosition = window.getComputedStyle(target).position;
  if (computedPosition === 'static') {
    target.style.position = 'relative';
  }

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  target.appendChild(canvas);

  const originX = rect.width / 2;
  const originY = rect.height / 2;
  const particles: Particle[] = Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = randomBetween(2, 6);
    return {
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - randomBetween(0.4, 1.2),
      radius: randomBetween(radiusRange[0], radiusRange[1]),
      color: pickOne(colors),
      opacity: randomBetween(0.7, 1),
      fadeRate: randomBetween(0.012, 0.024),
    };
  });

  let disposed = false;
  let frameId = 0;
  let lastFrameAt = performance.now();
  const startedAt = lastFrameAt;

  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    if (frameId) {
      window.cancelAnimationFrame(frameId);
      frameId = 0;
    }
    if (canvas.parentElement) {
      canvas.remove();
    }
    if (computedPosition === 'static') {
      target.style.position = previousPosition;
    }
  };

  const renderFrame = (now: number): void => {
    if (disposed) return;

    const elapsed = now - startedAt;
    const dt = clampFrameDelta(now - lastFrameAt);
    lastFrameAt = now;

    context.clearRect(0, 0, rect.width, rect.height);

    for (const particle of particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += GRAVITY * dt;
      particle.opacity = Math.max(0, particle.opacity - particle.fadeRate * dt);

      if (particle.opacity <= 0) continue;

      context.globalAlpha = particle.opacity * Math.max(0, 1 - elapsed / duration);
      context.beginPath();
      context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      context.fillStyle = particle.color;
      context.fill();
    }

    context.globalAlpha = 1;

    if (elapsed >= duration) {
      cleanup();
      return;
    }

    frameId = window.requestAnimationFrame(renderFrame);
  };

  frameId = window.requestAnimationFrame(renderFrame);
  return cleanup;
}
