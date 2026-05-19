interface OgMetaOptions {
  title: string;
  description: string;
  url?: string;
  image?: string;
}

const CANONICAL_ORIGIN = 'https://phillylaxstats.com';

function ensureMeta(selector: string, attrs: Record<string, string>): HTMLMetaElement {
  let meta = document.head.querySelector<HTMLMetaElement>(selector);
  if (!meta) {
    meta = document.createElement('meta');
    for (const [key, value] of Object.entries(attrs)) meta.setAttribute(key, value);
    document.head.appendChild(meta);
  }
  return meta;
}

function normalizeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, window.location.href).href;
  } catch {
    return value;
  }
}

function buildCanonicalUrl(value: string | undefined): string | undefined {
  const normalized = normalizeUrl(value ?? window.location.href);
  if (!normalized) return undefined;

  try {
    const url = new URL(normalized, window.location.href);
    const hashRoute = url.hash && url.hash !== '#'
      ? (url.hash.startsWith('#/') ? url.hash : `#/${url.hash.replace(/^#/, '')}`)
      : url.pathname !== '/' || url.search
        ? `#${url.pathname}${url.search}`
        : '#/';
    return `${CANONICAL_ORIGIN}/${hashRoute}`;
  } catch {
    return normalized;
  }
}

export function setCanonicalUrl(value: string | undefined): void {
  const url = buildCanonicalUrl(value ?? window.location.href);
  if (!url) return;
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  link.href = url;
}

export function setOgMeta(opts: OgMetaOptions): void {
  document.title = opts.title;

  const url = normalizeUrl(opts.url ?? window.location.href);
  const image = normalizeUrl(opts.image);
  const twitterCard = image ? 'summary_large_image' : 'summary';

  ensureMeta('meta[name="description"]', { name: 'description' }).content = opts.description;
  ensureMeta('meta[property="og:title"]', { property: 'og:title' }).content = opts.title;
  ensureMeta('meta[property="og:description"]', { property: 'og:description' }).content = opts.description;
  ensureMeta('meta[property="og:type"]', { property: 'og:type' }).content = 'website';
  ensureMeta('meta[name="twitter:title"]', { name: 'twitter:title' }).content = opts.title;
  ensureMeta('meta[name="twitter:description"]', { name: 'twitter:description' }).content = opts.description;
  ensureMeta('meta[name="twitter:card"]', { name: 'twitter:card' }).content = twitterCard;

  if (url) {
    ensureMeta('meta[property="og:url"]', { property: 'og:url' }).content = url;
  }

  setCanonicalUrl(opts.url ?? window.location.href);

  const ogImage = ensureMeta('meta[property="og:image"]', { property: 'og:image' });
  const twitterImage = ensureMeta('meta[name="twitter:image"]', { name: 'twitter:image' });
  if (image) {
    ogImage.content = image;
    twitterImage.content = image;
  } else {
    ogImage.removeAttribute('content');
    twitterImage.removeAttribute('content');
  }
}
