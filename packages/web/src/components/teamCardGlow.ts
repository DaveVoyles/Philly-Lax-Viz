import { Application, Graphics } from 'pixi.js';

export interface GlowHandle {
  destroy: () => void;
}

interface GlowStrip {
  graphic: Graphics;
  phase: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FALLBACK_COLOR = '#4ea1ff';
const CARD_PADDING = 4;
const CORNER_RADIUS = 10;
const RESIZE_DEBOUNCE_MS = 120;
const LAYERS = [
  { spread: 8, alpha: 0.1 },
  { spread: 4, alpha: 0.2 },
  { spread: 0, alpha: 0.35 },
] as const;

/**
 * Mounts a Pixi.js canvas behind a team grid element and renders animated
 * glow strips aligned with each team card's position. Cards pulse with their
 * team's primary color.
 *
 * @param gridContainer - The `.team-grid` UL element
 * @param teamColors - Map of team element index to hex color string (e.g. "#1d4ed8")
 */
export function mountTeamCardGlow(
  gridContainer: HTMLElement,
  teamColors: Map<number, string>,
): GlowHandle {
  const parent = gridContainer.parentElement;
  if (!parent) {
    return { destroy: () => undefined };
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'team-card-glow-wrapper';
  wrapper.style.position = 'relative';
  wrapper.style.isolation = 'isolate';

  const canvasLayer = document.createElement('div');
  canvasLayer.className = 'team-card-glow-canvas';
  canvasLayer.setAttribute('aria-hidden', 'true');
  canvasLayer.style.position = 'absolute';
  canvasLayer.style.inset = '0';
  canvasLayer.style.pointerEvents = 'none';
  canvasLayer.style.zIndex = '-1';
  canvasLayer.style.overflow = 'visible';

  const originalPosition = gridContainer.style.position;
  const originalZIndex = gridContainer.style.zIndex;

  parent.insertBefore(wrapper, gridContainer);
  wrapper.appendChild(canvasLayer);
  wrapper.appendChild(gridContainer);
  gridContainer.style.position = 'relative';
  gridContainer.style.zIndex = '1';

  const app = new Application();
  const glowStrips: GlowStrip[] = [];
  let destroyed = false;
  let resizeTimer: number | null = null;
  let appReady = false;

  function parseHexColor(hex: string | undefined): number {
    const value = hex && /^#?[0-9a-fA-F]{6}$/.test(hex) ? hex : FALLBACK_COLOR;
    const normalized = value.startsWith('#') ? value : `#${value}`;
    const parsed = parseInt(normalized.replace('#', ''), 16);
    return Number.isFinite(parsed) ? parsed : parseInt(FALLBACK_COLOR.replace('#', ''), 16);
  }

  function relativeCardBox(card: Element, gridRect: DOMRect): Box {
    const rect = card.getBoundingClientRect();
    return {
      x: rect.left - gridRect.left - CARD_PADDING,
      y: rect.top - gridRect.top - CARD_PADDING,
      width: rect.width + CARD_PADDING * 2,
      height: rect.height + CARD_PADDING * 2,
    };
  }

  function drawGlow(graphic: Graphics, box: Box, color: number): void {
    graphic.clear();
    for (const layer of LAYERS) {
      const spread = layer.spread;
      graphic
        .roundRect(
          box.x - spread,
          box.y - spread,
          box.width + spread * 2,
          box.height + spread * 2,
          CORNER_RADIUS + spread,
        )
        .fill({ color, alpha: layer.alpha });
    }
  }

  function syncCanvasSize(): void {
    const width = Math.max(1, Math.ceil(gridContainer.clientWidth));
    const height = Math.max(1, Math.ceil(gridContainer.clientHeight));
    if (appReady) {
      app.renderer.resize(width, height);
    }
  }

  function layoutGlows(): void {
    if (!appReady || destroyed) return;

    syncCanvasSize();

    const cards = Array.from(gridContainer.querySelectorAll('li'));
    const gridRect = gridContainer.getBoundingClientRect();

    while (glowStrips.length < cards.length) {
      const graphic = new Graphics();
      graphic.alpha = 0.25;
      app.stage.addChild(graphic);
      glowStrips.push({
        graphic,
        phase: glowStrips.length * 0.65,
      });
    }

    while (glowStrips.length > cards.length) {
      const strip = glowStrips.pop();
      if (!strip) break;
      app.stage.removeChild(strip.graphic);
      strip.graphic.destroy();
    }

    cards.forEach((card, index) => {
      const strip = glowStrips[index];
      if (!strip) return;
      const color = parseHexColor(teamColors.get(index));
      drawGlow(strip.graphic, relativeCardBox(card, gridRect), color);
      strip.graphic.visible = true;
    });
  }

  function onResize(): void {
    if (resizeTimer !== null) {
      window.clearTimeout(resizeTimer);
    }
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      layoutGlows();
    }, RESIZE_DEBOUNCE_MS);
  }

  void (async () => {
    try {
      await app.init({
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio ?? 1, 2),
        autoDensity: true,
        width: Math.max(1, Math.ceil(gridContainer.clientWidth)),
        height: Math.max(1, Math.ceil(gridContainer.clientHeight)),
      });

      if (destroyed) {
        app.destroy(true, { children: true });
        return;
      }

      appReady = true;
      app.canvas.style.position = 'absolute';
      app.canvas.style.inset = '0';
      app.canvas.style.width = '100%';
      app.canvas.style.height = '100%';
      app.canvas.style.pointerEvents = 'none';
      app.canvas.style.display = 'block';
      canvasLayer.appendChild(app.canvas);

      layoutGlows();

      app.ticker.add((ticker) => {
        const time = ticker.lastTime / 1000;
        for (const strip of glowStrips) {
          strip.graphic.alpha = Math.max(0.05, 0.25 + 0.2 * Math.sin(time * 2 + strip.phase));
        }
      });
    } catch {
      if (destroyed) return;
      gridContainer.style.position = originalPosition;
      gridContainer.style.zIndex = originalZIndex;
      const wrapperParent = wrapper.parentElement;
      if (wrapperParent) {
        wrapperParent.insertBefore(gridContainer, wrapper);
        wrapper.remove();
      }
    }
  })();

  window.addEventListener('resize', onResize);

  return {
    destroy: () => {
      if (destroyed) return;
      destroyed = true;

      window.removeEventListener('resize', onResize);
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
        resizeTimer = null;
      }

      app.destroy(true, { children: true });

      gridContainer.style.position = originalPosition;
      gridContainer.style.zIndex = originalZIndex;

      const wrapperParent = wrapper.parentElement;
      if (wrapperParent) {
        wrapperParent.insertBefore(gridContainer, wrapper);
        wrapper.remove();
      }
    },
  };
}
