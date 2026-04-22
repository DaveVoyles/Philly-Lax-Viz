// TeamBadge — renders a team logo (or initials fallback) next to a team name.
// Wave 3 Lane 3 (Leia). Used across dashboard, leaders, team detail, game detail.

export type TeamBadgeSize = 'sm' | 'md' | 'lg' | 'xl';

export interface TeamBadgeOptions {
  name: string;
  logoUrl: string | null;
  size?: TeamBadgeSize;
  href?: string;
}

const SIZE_PX: Record<TeamBadgeSize, number> = {
  sm: 20,
  md: 32,
  lg: 48,
  xl: 80,
};

// Deterministic palette for initials fallback so the same team always gets the
// same colored circle. Picked for reasonable contrast against white initials in
// both light + dark themes.
const FALLBACK_COLORS = [
  '#1d4ed8', '#7c3aed', '#db2777', '#dc2626', '#ea580c',
  '#ca8a04', '#16a34a', '#0d9488', '#0284c7', '#4f46e5',
  '#9333ea', '#be123c', '#0f766e', '#374151', '#854d0e',
];

function hashName(name: string): number {
  // Tiny djb2-style hash; deterministic, no deps.
  let h = 5381;
  for (let i = 0; i < name.length; i += 1) {
    h = ((h << 5) + h + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function colorForName(name: string): string {
  const idx = hashName(name) % FALLBACK_COLORS.length;
  return FALLBACK_COLORS[idx] ?? '#374151';
}

function initialsFor(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/\s+/).filter((p) => /[A-Za-z0-9]/.test(p));
  if (parts.length === 0) return cleaned.slice(0, 1).toUpperCase();
  if (parts.length === 1) {
    const p = parts[0] ?? '';
    return p.slice(0, 2).toUpperCase();
  }
  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

function buildInitialsEl(name: string, px: number): HTMLElement {
  const span = document.createElement('span');
  span.className = 'team-badge__initials';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = initialsFor(name);
  span.style.width = `${px}px`;
  span.style.height = `${px}px`;
  span.style.lineHeight = `${px}px`;
  span.style.fontSize = `${Math.max(10, Math.round(px * 0.42))}px`;
  span.style.background = colorForName(name);
  return span;
}

function buildLogoEl(opts: TeamBadgeOptions, px: number): HTMLElement {
  if (opts.logoUrl) {
    const img = document.createElement('img');
    img.src = opts.logoUrl;
    img.alt = `${opts.name} logo`;
    img.width = px;
    img.height = px;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.className = 'team-badge__img';
    // If an image 404s mid-session, swap to the initials placeholder rather
    // than letting the broken-image icon flash.
    img.addEventListener(
      'error',
      () => {
        const fallback = buildInitialsEl(opts.name, px);
        img.replaceWith(fallback);
      },
      { once: true },
    );
    return img;
  }
  return buildInitialsEl(opts.name, px);
}

export function renderTeamBadge(opts: TeamBadgeOptions): HTMLElement {
  const size: TeamBadgeSize = opts.size ?? 'md';
  const px = SIZE_PX[size];

  const wrap = document.createElement('span');
  wrap.className = `team-badge team-badge--${size}`;

  const logoEl = buildLogoEl(opts, px);
  wrap.appendChild(logoEl);

  const label = document.createElement('span');
  label.className = 'team-badge__name';
  label.textContent = opts.name;
  wrap.appendChild(label);

  if (opts.href) {
    const a = document.createElement('a');
    a.className = 'team-badge-link';
    a.href = opts.href;
    a.appendChild(wrap);
    return a;
  }
  return wrap;
}
