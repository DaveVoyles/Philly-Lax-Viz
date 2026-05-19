/**
 * Nav glow effect — a canvas-based animated underline shimmer on hover
 * and a particle burst on click for nav links. Uses requestAnimationFrame
 * for smooth GPU-accelerated rendering.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  hue: number;
}

const ACCENT_HUE = 190; // cyan-ish to match --accent (#00d4ff)

/**
 * Mount the nav glow effect on all nav links within the given container.
 * Call once after the shell is rendered.
 */
export function mountNavGlow(nav: HTMLElement): void {
  const canvas = document.createElement('canvas');
  canvas.className = 'nav-glow-canvas';
  canvas.style.cssText =
    'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1;';
  nav.style.position = 'relative';
  nav.insertBefore(canvas, nav.firstChild);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let particles: Particle[] = [];
  let glowTarget: { x: number; y: number; w: number; h: number } | null = null;
  let glowAlpha = 0;
  let animFrame = 0;
  let running = false;

  function resize(): void {
    const rect = nav.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx!.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(nav);

  function spawnParticles(x: number, y: number): void {
    const count = 12 + Math.floor(Math.random() * 8);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        life: 1,
        maxLife: 0.4 + Math.random() * 0.4,
        size: 1.5 + Math.random() * 2.5,
        hue: ACCENT_HUE + (Math.random() - 0.5) * 30,
      });
    }
    ensureRunning();
  }

  function ensureRunning(): void {
    if (!running) {
      running = true;
      animFrame = requestAnimationFrame(tick);
    }
  }

  function tick(): void {
    if (!ctx) return;
    const { width, height } = canvas.style;
    const w = parseFloat(width);
    const h = parseFloat(height);
    ctx.clearRect(0, 0, w, h);

    // Draw glow underline on hover
    if (glowTarget) {
      glowAlpha = Math.min(1, glowAlpha + 0.08);
    } else {
      glowAlpha = Math.max(0, glowAlpha - 0.06);
    }

    if (glowAlpha > 0 && glowTarget) {
      const g = glowTarget;
      const gradient = ctx.createLinearGradient(g.x, g.y + g.h, g.x + g.w, g.y + g.h);
      gradient.addColorStop(0, `hsla(${ACCENT_HUE}, 100%, 60%, 0)`);
      gradient.addColorStop(0.3, `hsla(${ACCENT_HUE}, 100%, 60%, ${0.6 * glowAlpha})`);
      gradient.addColorStop(0.7, `hsla(${ACCENT_HUE + 20}, 100%, 70%, ${0.6 * glowAlpha})`);
      gradient.addColorStop(1, `hsla(${ACCENT_HUE}, 100%, 60%, 0)`);

      ctx.shadowColor = `hsla(${ACCENT_HUE}, 100%, 60%, ${0.4 * glowAlpha})`;
      ctx.shadowBlur = 8;
      ctx.fillStyle = gradient;
      ctx.fillRect(g.x, g.y + g.h - 2, g.w, 2.5);
      ctx.shadowBlur = 0;

      // Subtle glow halo behind the link
      const radGrad = ctx.createRadialGradient(
        g.x + g.w / 2, g.y + g.h / 2, 0,
        g.x + g.w / 2, g.y + g.h / 2, g.w * 0.6,
      );
      radGrad.addColorStop(0, `hsla(${ACCENT_HUE}, 100%, 60%, ${0.08 * glowAlpha})`);
      radGrad.addColorStop(1, `hsla(${ACCENT_HUE}, 100%, 60%, 0)`);
      ctx.fillStyle = radGrad;
      ctx.fillRect(g.x - 10, g.y - 5, g.w + 20, g.h + 10);
    }

    // Draw and update particles
    const dt = 1 / 60;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!;
      p.life -= dt / p.maxLife;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15; // gravity

      const alpha = p.life * 0.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 100%, 65%, ${alpha})`;
      ctx.fill();
    }

    // Keep running if there's something to draw
    if (particles.length > 0 || glowAlpha > 0.01) {
      animFrame = requestAnimationFrame(tick);
    } else {
      running = false;
      ctx.clearRect(0, 0, w, h);
    }
  }

  // Event listeners on nav links
  const links = nav.querySelectorAll<HTMLAnchorElement>('a[data-nav]');

  for (const link of links) {
    link.addEventListener('mouseenter', () => {
      const rect = link.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      glowTarget = {
        x: rect.left - navRect.left,
        y: rect.top - navRect.top,
        w: rect.width,
        h: rect.height,
      };
      ensureRunning();
    });

    link.addEventListener('mouseleave', () => {
      glowTarget = null;
      ensureRunning();
    });

    link.addEventListener('click', (e) => {
      const rect = link.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      const cx = rect.left - navRect.left + rect.width / 2;
      const cy = rect.top - navRect.top + rect.height / 2;
      spawnParticles(cx, cy);
    });
  }
}
