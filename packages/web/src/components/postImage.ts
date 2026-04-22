// postImage.ts -- Wave 17 Lane 2 (Han). Tiny helpers for surfacing
// CDN-hosted post images on the web. No proxying, no preloading. We always
// render with `loading="lazy"` and explicit width/height to avoid CLS, and
// hide the element on 404 so missing source URLs don't break layout.

export interface PostImageOpts {
  url: string;
  alt?: string | null;
  width: number;
  height: number;
  className?: string;
  /** Inline style override. */
  style?: string;
}

export function renderPostImage(opts: PostImageOpts): HTMLImageElement {
  const img = document.createElement('img');
  img.src = opts.url;
  img.alt = opts.alt ?? '';
  img.width = opts.width;
  img.height = opts.height;
  img.loading = 'lazy';
  img.decoding = 'async';
  if (opts.className) img.className = opts.className;
  if (opts.style) img.setAttribute('style', opts.style);
  // Graceful fallback: the source CDN occasionally 404s on resized variants.
  img.addEventListener('error', () => {
    img.style.display = 'none';
  });
  return img;
}

/** Tiny thumbnail for game cards (60x40). */
export function renderGameThumb(url: string, alt: string | null = null): HTMLImageElement {
  return renderPostImage({
    url,
    alt,
    width: 60,
    height: 40,
    style:
      'width:60px; height:40px; object-fit:cover; border-radius:4px; flex-shrink:0; background:var(--bg-elev, #222);',
  });
}

/** Hero shot for game-detail page (max 600x400 preserving aspect). */
export function renderGameHero(url: string, alt: string | null = null): HTMLImageElement {
  return renderPostImage({
    url,
    alt,
    width: 600,
    height: 400,
    style:
      'display:block; width:100%; max-width:600px; height:auto; aspect-ratio: 3 / 2; object-fit:cover; border-radius:8px; margin:.5rem 0 1rem;',
  });
}

/** Square avatar for commits / player rows (48x48). */
export function renderPlayerAvatar(url: string, alt: string | null = null): HTMLImageElement {
  return renderPostImage({
    url,
    alt,
    width: 48,
    height: 48,
    style:
      'width:48px; height:48px; object-fit:cover; border-radius:50%; flex-shrink:0; background:var(--bg-elev, #222);',
  });
}
