const STYLE_ID = 'pbla-view-styles';

export function ensureStyles(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;

  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .pbla-view-root {
      --pbla-accent: #ffd166;
      --pbla-white: #f8fafc;
      --pbla-muted: #94a3b8;
      --pbla-ink: #05070d;
      --pbla-panel: rgba(9, 13, 24, 0.84);
      --pbla-panel-strong: rgba(9, 13, 24, 0.94);
      --pbla-border: rgba(255, 209, 102, 0.14);
      position: relative;
      isolation: isolate;
      padding-bottom: 1.25rem;
    }
    .pbla-webgl {
      position: absolute;
      inset: 0;
      z-index: -1;
      pointer-events: none;
      overflow: hidden;
    }
    .pbla-shell {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }
    .pbla-panel {
      position: relative;
      overflow: hidden;
      border-radius: 20px;
      border: 1px solid var(--pbla-border);
      background:
        linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0)),
        var(--pbla-panel);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.05),
        0 24px 60px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(18px);
    }
    .pbla-panel::after {
      content: '';
      position: absolute;
      inset: auto -10% -32% auto;
      width: 220px;
      height: 220px;
      border-radius: 999px;
      background: radial-gradient(circle, rgba(246, 140, 31, 0.18), transparent 72%);
      pointer-events: none;
    }
    .pbla-hero {
      padding: 1.3rem;
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.9fr);
      gap: 1rem;
      align-items: stretch;
    }
    .pbla-hero__copy {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      min-width: 0;
    }
    .pbla-kicker {
      display: inline-flex;
      align-items: center;
      gap: 0.55rem;
      width: fit-content;
      max-width: 100%;
      padding: 0.45rem 0.8rem;
      border-radius: 999px;
      border: 1px solid rgba(246, 140, 31, 0.32);
      background: rgba(246, 140, 31, 0.12);
      color: var(--pbla-accent);
      font-size: 0.74rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .pbla-kicker__dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 999px;
      background: var(--pbla-accent);
      box-shadow: 0 0 16px rgba(246, 140, 31, 0.8);
      animation: pbla-pulse 1.9s ease-in-out infinite;
    }
    .pbla-hero__title {
      margin: 0;
      font-size: clamp(2.2rem, 4vw, 4rem);
      line-height: 0.94;
      letter-spacing: -0.04em;
      color: var(--pbla-white);
    }
    .pbla-hero__title-accent {
      display: block;
      margin-top: 0.2rem;
      background: linear-gradient(135deg, var(--pbla-accent), var(--pbla-accent), var(--pbla-white));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .pbla-hero__subtitle {
      margin: 0;
      max-width: 58ch;
      color: color-mix(in srgb, var(--pbla-white) 72%, transparent);
      font-size: 1rem;
      line-height: 1.65;
    }
    .pbla-hero__chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem;
    }
    .pbla-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.5rem 0.8rem;
      border-radius: 999px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
      color: color-mix(in srgb, var(--pbla-white) 78%, transparent);
      font-size: 0.82rem;
      font-weight: 700;
    }
    .pbla-live-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      width: fit-content;
      max-width: 100%;
      padding: 0.5rem 1rem;
      border-radius: 999px;
      background: rgba(255, 0, 0, 0.08);
      border: 1px solid rgba(255, 0, 0, 0.25);
      color: var(--pbla-white);
      text-decoration: none;
      transition: transform 200ms ease, background 200ms ease, border-color 200ms ease, box-shadow 200ms ease;
    }
    .pbla-live-badge:hover,
    .pbla-live-badge:focus-visible {
      transform: translateY(-1px);
      border-color: rgba(255, 0, 0, 0.42);
      outline: none;
    }
    .pbla-live-badge--active {
      background: rgba(255, 0, 0, 0.15);
      border-color: rgba(255, 0, 0, 0.5);
      box-shadow: 0 0 20px rgba(255, 0, 0, 0.3);
    }
    .pbla-live-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1rem;
      height: 1rem;
      color: #ff4444;
      flex: 0 0 auto;
    }
    .pbla-live-icon svg {
      width: 100%;
      height: 100%;
      fill: currentColor;
    }
    .pbla-live-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #666;
      flex: 0 0 auto;
    }
    .pbla-live-badge--active .pbla-live-dot {
      background: #ff0000;
      animation: pbla-live-pulse 1.5s ease-in-out infinite;
      box-shadow: 0 0 8px rgba(255, 0, 0, 0.6);
    }
    .pbla-live-text {
      font-size: 0.82rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      line-height: 1.1;
    }
    .pbla-live-badge--active .pbla-live-text {
      color: #ff4444;
    }
    .pbla-hero__side {
      display: grid;
      gap: 0.95rem;
      min-width: 0;
    }
    .pbla-side-card {
      position: relative;
      overflow: hidden;
      border-radius: 18px;
      border: 1px solid rgba(255, 209, 102, 0.18);
      background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0)), rgba(5, 7, 13, 0.68);
      padding: 1rem;
    }
    .pbla-side-card__eyebrow {
      margin: 0 0 0.35rem;
      color: var(--pbla-accent);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .pbla-side-card__title {
      margin: 0;
      color: var(--pbla-white);
      font-size: 1rem;
      font-weight: 800;
    }
    .pbla-side-card__text {
      margin: 0.4rem 0 0;
      color: color-mix(in srgb, var(--pbla-white) 70%, transparent);
      font-size: 0.88rem;
      line-height: 1.55;
    }
    .pbla-goalie-lane {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.6rem;
      margin-top: 0.9rem;
    }
    .pbla-goalie-pill {
      padding: 0.7rem 0.45rem;
      border-radius: 14px;
      border: 1px dashed rgba(255, 209, 102, 0.22);
      background: rgba(255,255,255,0.03);
      text-align: center;
    }
    .pbla-goalie-pill__value {
      display: block;
      color: var(--pbla-white);
      font-size: 0.95rem;
      font-weight: 800;
    }
    .pbla-goalie-pill__label {
      display: block;
      margin-top: 0.15rem;
      color: color-mix(in srgb, var(--pbla-white) 64%, transparent);
      font-size: 0.72rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .pbla-goalie-pill__team {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.25rem;
      margin-top: 0.25rem;
      font-size: 0.62rem;
      letter-spacing: 0.04em;
      color: color-mix(in srgb, var(--pbla-white) 50%, transparent);
    }
    .pbla-goalie-pill__dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: var(--team-color, #888);
      flex-shrink: 0;
    }
    .pbla-season-bar {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 0.55rem;
      padding: 0.32rem;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.03);
      width: fit-content;
    }
    .pbla-season-btn {
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: color-mix(in srgb, var(--pbla-white) 62%, transparent);
      padding: 0.55rem 0.95rem;
      font: inherit;
      font-size: 0.84rem;
      font-weight: 700;
      cursor: pointer;
      transition: transform 180ms ease, background 180ms ease, color 180ms ease, box-shadow 180ms ease;
    }
    .pbla-season-btn:hover {
      transform: translateY(-1px);
      color: var(--pbla-white);
    }
    .pbla-season-btn.is-active {
      background: linear-gradient(135deg, rgba(246, 140, 31, 0.22), rgba(255, 209, 102, 0.18));
      color: var(--pbla-white);
      box-shadow: 0 0 0 1px rgba(255, 209, 102, 0.18) inset;
    }
    .pbla-season-summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.85rem;
      padding: 0 0.2rem;
    }
    .pbla-summary-card {
      position: relative;
      padding: 1rem;
      border-radius: 18px;
      border: 1px solid rgba(255, 209, 102, 0.22);
      background: rgba(255,255,255,0.03);
      min-width: 0;
      overflow: hidden;
      animation: cardGlow 3s ease-in-out infinite alternate;
    }
    .pbla-summary-card:nth-child(2) { animation-delay: 0.75s; }
    .pbla-summary-card:nth-child(3) { animation-delay: 1.5s; }
    .pbla-summary-card:nth-child(4) { animation-delay: 2.25s; }
    .pbla-summary-card::before {
      content: '';
      position: absolute;
      inset: -1px;
      border-radius: 18px;
      padding: 1px;
      background: linear-gradient(135deg, rgba(246, 140, 31, 0.5), rgba(255, 209, 102, 0.2), rgba(246, 140, 31, 0.5));
      background-size: 200% 200%;
      animation: shimmerBorder 4s linear infinite;
      -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
    }
    .pbla-summary-card::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 18px;
      background: radial-gradient(ellipse at 50% 0%, rgba(246, 140, 31, 0.12), transparent 70%);
      pointer-events: none;
    }
    @keyframes cardGlow {
      0% { box-shadow: 0 0 8px rgba(246, 140, 31, 0.15), inset 0 0 12px rgba(246, 140, 31, 0.05); }
      100% { box-shadow: 0 0 20px rgba(246, 140, 31, 0.3), inset 0 0 20px rgba(246, 140, 31, 0.08); }
    }
    @keyframes shimmerBorder {
      0% { background-position: 0% 50%; }
      100% { background-position: 200% 50%; }
    }
    .pbla-summary-card__label {
      display: block;
      position: relative;
      z-index: 1;
      margin-bottom: 0.4rem;
      color: color-mix(in srgb, var(--pbla-white) 64%, transparent);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .pbla-summary-card__value {
      display: block;
      position: relative;
      z-index: 1;
      color: var(--pbla-white);
      font-size: clamp(1.55rem, 2vw, 2.2rem);
      font-weight: 900;
      line-height: 1;
    }
    .pbla-summary-card__note {
      display: block;
      position: relative;
      z-index: 1;
      margin-top: 0.35rem;
      color: color-mix(in srgb, var(--pbla-white) 58%, transparent);
      font-size: 0.78rem;
      line-height: 1.4;
    }
    .pbla-section {
      padding: 1.1rem;
    }
    .pbla-section__header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
      flex-wrap: wrap;
    }
    .pbla-section__eyebrow {
      display: block;
      margin-bottom: 0.3rem;
      color: var(--pbla-accent);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .pbla-section__title {
      margin: 0;
      color: var(--pbla-white);
      font-size: clamp(1.3rem, 2vw, 1.8rem);
      font-weight: 900;
      letter-spacing: -0.03em;
    }
    .pbla-section__subtitle {
      margin: 0.3rem 0 0;
      color: color-mix(in srgb, var(--pbla-white) 66%, transparent);
      font-size: 0.9rem;
      line-height: 1.55;
      max-width: 62ch;
    }
    .pbla-section__meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      color: color-mix(in srgb, var(--pbla-white) 60%, transparent);
      font-size: 0.82rem;
      font-weight: 700;
    }
    .pbla-meta-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.35rem 0.7rem;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 800;
      letter-spacing: 0.02em;
    }
    .pbla-meta-badge--gold {
      background: rgba(255, 209, 102, 0.15);
      border: 1px solid rgba(255, 209, 102, 0.35);
      color: var(--pbla-accent);
    }
    .pbla-meta-badge--fire {
      background: rgba(255, 209, 102, 0.12);
      border: 1px solid rgba(255, 209, 102, 0.30);
      color: var(--pbla-accent);
    }
    .pbla-standings-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.7rem;
    }
    .pbla-table-stack {
      display: grid;
      gap: 0.75rem;
      margin-top: 0.75rem;
    }
    .pbla-table-note {
      margin: 0;
      color: color-mix(in srgb, var(--pbla-white) 62%, transparent);
      font-size: 0.82rem;
      line-height: 1.5;
    }
    .pbla-team-card {
      position: relative;
      overflow: hidden;
      display: grid;
      gap: 0.45rem;
      padding: 0.65rem 0.9rem;
      border-radius: 16px;
      border: 1px solid color-mix(in srgb, var(--team-color) 30%, transparent);
      background: linear-gradient(135deg, color-mix(in srgb, var(--team-color) 8%, transparent), color-mix(in srgb, var(--team-secondary) 5%, transparent)), rgba(6, 10, 18, 0.92);
      text-decoration: none;
      color: inherit;
      box-shadow: inset 0 1px 0 color-mix(in srgb, var(--team-secondary) 12%, transparent);
      transition: transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 280ms ease, border-color 280ms ease;
      opacity: 0;
      transform: translateY(18px) scale(0.985);
    }
    .pbla-team-card::before {
      content: '';
      position: absolute;
      inset: auto -8% -38% auto;
      width: 180px;
      height: 180px;
      border-radius: 999px;
      background: radial-gradient(circle, color-mix(in srgb, var(--team-color) 20%, transparent), transparent 72%);
      pointer-events: none;
      opacity: 0.95;
    }
    .pbla-team-card::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(
        105deg,
        transparent 40%,
        rgba(255,255,255,0.06) 45%,
        rgba(255,255,255,0.12) 50%,
        rgba(255,255,255,0.06) 55%,
        transparent 60%
      );
      transform: translateX(-100%);
      transition: transform 600ms ease;
      pointer-events: none;
      border-radius: inherit;
    }
    .pbla-team-card:hover,
    .pbla-team-card:focus-visible {
      transform: scale(1.02) translateY(-2px);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.04),
        0 8px 32px rgba(0,0,0,0.3),
        0 0 0 1px color-mix(in srgb, var(--team-color) 36%, transparent),
        0 16px 36px color-mix(in srgb, var(--team-color) 18%, transparent);
      border-color: color-mix(in srgb, var(--team-color) 40%, transparent);
      outline: none;
    }
    .pbla-team-card:hover::after,
    .pbla-team-card:focus-visible::after {
      transform: translateX(100%);
    }
    .pbla-team-card.is-visible {
      opacity: 1;
      transform: translateY(0) scale(1);
      transition: transform 560ms cubic-bezier(0.22, 1, 0.36, 1), opacity 560ms ease;
      transition-delay: var(--delay, 0ms);
    }
    .pbla-team-card__top {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 0.8rem;
    }
    .pbla-rank-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 2.4rem;
      height: 2.4rem;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--team-color) 44%, transparent);
      background: color-mix(in srgb, var(--team-color) 16%, transparent);
      color: var(--team-color);
      font-size: 0.8rem;
      font-weight: 900;
      letter-spacing: 0.04em;
      position: relative;
      z-index: 1;
    }
    .pbla-team-card__identity {
      min-width: 0;
      flex: 1;
      position: relative;
      z-index: 1;
    }
    .pbla-team-card__headline {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      min-width: 0;
    }
    .pbla-team-card__swatch {
      flex: 0 0 auto;
      width: 0.8rem;
      height: 0.8rem;
      border-radius: 999px;
      background: var(--team-color);
      box-shadow: 0 0 18px color-mix(in srgb, var(--team-color) 42%, transparent);
      transition: transform 220ms ease, box-shadow 220ms ease;
    }
    .pbla-team-card:hover .pbla-team-card__swatch,
    .pbla-team-card:focus-visible .pbla-team-card__swatch {
      transform: scale(1.22);
      box-shadow: 0 0 22px color-mix(in srgb, var(--team-color) 60%, transparent);
    }
    .pbla-team-card__swatch.is-pulsing {
      animation: pbla-team-swatch-pulse 460ms ease;
    }
    .pbla-team-card__name {
      margin: 0;
      color: var(--pbla-white);
      font-size: 0.95rem;
      font-weight: 900;
      letter-spacing: -0.02em;
      min-width: 0;
    }
    .pbla-team-card__record {
      margin-top: 0.15rem;
      color: color-mix(in srgb, var(--pbla-white) 68%, transparent);
      font-size: 0.8rem;
      line-height: 1.35;
    }
    .pbla-streak {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.35rem 0.55rem;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      white-space: nowrap;
      position: relative;
      z-index: 1;
    }
    .pbla-streak--win {
      color: #86efac;
      border: 1px solid rgba(134, 239, 172, 0.18);
      background: rgba(34, 197, 94, 0.11);
    }
    .pbla-streak--loss {
      color: #fca5a5;
      border: 1px solid rgba(252, 165, 165, 0.18);
      background: rgba(239, 68, 68, 0.11);
    }
    .pbla-team-card__stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.4rem;
      position: relative;
      z-index: 1;
    }
    .pbla-team-stat {
      padding: 0.45rem 0.5rem;
      border-radius: 10px;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.05);
      transition: background 220ms ease, border-color 220ms ease;
    }
    .pbla-team-card:hover .pbla-team-stat,
    .pbla-team-card:focus-visible .pbla-team-stat {
      background: color-mix(in srgb, var(--team-color) 10%, rgba(255,255,255,0.03));
      border-color: color-mix(in srgb, var(--team-color) 22%, rgba(255,255,255,0.05));
    }
    .pbla-team-stat__label {
      display: block;
      color: color-mix(in srgb, var(--pbla-white) 58%, transparent);
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }
    .pbla-team-stat__value {
      display: block;
      margin-top: 0.35rem;
      color: var(--pbla-white);
      font-size: 1.18rem;
      font-weight: 900;
      line-height: 1;
    }
    .pbla-team-card__win {
      display: grid;
      gap: 0.45rem;
      position: relative;
      z-index: 1;
    }
    .pbla-team-card__win-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      color: color-mix(in srgb, var(--pbla-white) 64%, transparent);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .pbla-win-track {
      height: 3px;
      border-radius: 999px;
      background: rgba(255,255,255,0.08);
      overflow: hidden;
    }
    .pbla-win-bar {
      height: 3px;
      border-radius: 2px;
      background: var(--team-color);
      transform-origin: left;
      transform: scaleX(0);
      transition: transform 800ms cubic-bezier(0.16, 1, 0.3, 1);
      opacity: 0.7;
    }
    .pbla-win-bar.is-visible {
      transform: scaleX(var(--win-pct));
    }
    .pbla-table-shell {
      overflow-x: auto;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.06);
      background: rgba(255,255,255,0.02);
    }
    .pbla-data-table {
      width: 100%;
      min-width: 760px;
      border-collapse: separate;
      border-spacing: 0;
    }
    .pbla-data-table thead,
    .pbla-data-table tbody {
      display: block;
    }
    .pbla-data-table thead tr,
    .pbla-data-table tbody tr {
      display: grid;
      width: 100%;
      align-items: center;
    }
    .pbla-standings-table thead tr,
    .pbla-standings-table tbody tr {
      grid-template-columns: 4.5rem minmax(12rem, 1.8fr) repeat(7, minmax(4.5rem, 0.72fr));
    }
    .pbla-leaders-table thead tr,
    .pbla-leaders-table tbody tr {
      grid-template-columns: 4.5rem minmax(15rem, 1.9fr) minmax(10rem, 1.25fr) repeat(5, minmax(4rem, 0.7fr));
    }
    .pbla-data-table th,
    .pbla-data-table td {
      padding: 0.85rem 0.8rem;
      text-align: left;
      color: color-mix(in srgb, var(--pbla-white) 82%, transparent);
      font-size: 0.89rem;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      position: relative;
      z-index: 1;
    }
    .pbla-data-table th {
      color: color-mix(in srgb, var(--pbla-white) 58%, transparent);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.03);
    }
    .pbla-standings-table th:nth-child(n + 3),
    .pbla-standings-table td:nth-child(n + 3),
    .pbla-leaders-table th:nth-child(n + 4),
    .pbla-leaders-table td:nth-child(n + 4) {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .pbla-sort-header {
      cursor: pointer;
      user-select: none;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      opacity: 0.7;
      transition: opacity 150ms;
      border: 0;
      background: transparent;
      padding: 0;
      color: inherit;
      font: inherit;
      text-transform: inherit;
      letter-spacing: inherit;
    }
    .pbla-sort-header:hover,
    .pbla-sort-header:focus-visible,
    .pbla-sort-header--active {
      opacity: 1;
      outline: none;
    }
    .pbla-sort-arrow {
      font-size: 0.7em;
      transition: transform 200ms, opacity 150ms;
      opacity: 0;
    }
    .pbla-sort-header--active .pbla-sort-arrow {
      opacity: 1;
    }
    .pbla-sort-arrow--desc {
      transform: rotate(180deg);
    }
    .pbla-standings-row,
    .pbla-leaders-row {
      position: relative;
      overflow: hidden;
      opacity: 0;
      border-left: 3px solid color-mix(in srgb, var(--team-color) 70%, transparent);
      background: linear-gradient(90deg, color-mix(in srgb, var(--team-color) 6%, transparent), transparent 60%);
    }
    .pbla-standings-row {
      transform: translateY(12px);
    }
    .pbla-leaders-row {
      transform: translateX(-12px);
    }
    .pbla-standings-row.is-visible,
    .pbla-leaders-row.is-visible {
      opacity: 1;
      transition: transform 520ms cubic-bezier(0.22, 1, 0.36, 1), opacity 520ms ease;
      transition-delay: var(--delay, 0ms);
    }
    .pbla-standings-row.is-visible {
      transform: translateY(0);
    }
    .pbla-leaders-row.is-visible {
      transform: translateX(0);
    }
    .pbla-standings-row:hover,
    .pbla-standings-row:focus-within,
    .pbla-leaders-row:hover,
    .pbla-leaders-row:focus-within {
      background: linear-gradient(90deg, color-mix(in srgb, var(--team-color) 14%, transparent), transparent 75%);
    }
    .pbla-points-bar {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      background: var(--team-color);
      opacity: 0.10;
      border-radius: 0.4rem;
      transform-origin: left;
      transform: scaleX(0);
      transition: transform 600ms cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: none;
      z-index: 0;
    }
    .pbla-points-bar.is-visible {
      transform: scaleX(var(--pts-pct));
    }
    .pbla-rank-cell {
      width: 3rem;
      color: var(--pbla-accent);
      font-weight: 900;
      white-space: nowrap;
    }
    .pbla-rank-fire {
      margin-left: 0.3rem;
      filter: drop-shadow(0 0 10px rgba(246, 140, 31, 0.55));
    }
    .pbla-player-cell,
    .pbla-team-name-cell {
      min-width: 190px;
    }
    .pbla-player-cell__name,
    .pbla-team-name-cell__name {
      display: block;
      color: var(--pbla-white);
      font-weight: 800;
    }
    .pbla-player-cell__jersey {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 2.35rem;
      height: 1.45rem;
      margin-right: 0.55rem;
      border-radius: 999px;
      background: rgba(246, 140, 31, 0.12);
      border: 1px solid rgba(246, 140, 31, 0.24);
      color: var(--pbla-accent);
      font-size: 0.72rem;
      font-weight: 800;
    }
    .pbla-team-cell,
    .pbla-team-name-cell__sub {
      color: color-mix(in srgb, var(--pbla-white) 66%, transparent);
      font-weight: 700;
    }
    .pbla-team-name-cell__sub {
      display: block;
      margin-top: 0.22rem;
      font-size: 0.82rem;
      font-weight: 600;
      line-height: 1.45;
    }
    .pbla-team-swatch {
      display: inline-block;
      width: 0.65rem;
      height: 0.65rem;
      margin-right: 0.45rem;
      border-radius: 999px;
      vertical-align: middle;
      box-shadow: 0 0 12px color-mix(in srgb, var(--swatch-color) 44%, transparent);
      background: var(--swatch-color);
    }
    .pbla-points-cell {
      color: var(--pbla-accent);
      font-weight: 900;
    }
    .pbla-games-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.85rem;
    }
    .pbla-game-card {
      display: grid;
      gap: 0.45rem;
      padding: 0.7rem 1rem;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.08);
      background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0)), rgba(6, 10, 18, 0.9);
      opacity: 0;
      transform: translateY(14px);
    }
    .pbla-game-card.is-visible {
      opacity: 1;
      transform: translateY(0);
      transition: transform 480ms cubic-bezier(0.22, 1, 0.36, 1), opacity 480ms ease;
      transition-delay: var(--delay, 0ms);
    }
    .pbla-game-card--playoff {
      border-color: rgba(255, 209, 102, 0.24);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 16px 32px rgba(255, 209, 102, 0.08);
    }
    .pbla-game-card__top {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .pbla-game-card__date {
      color: var(--pbla-accent);
      font-size: 0.82rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .pbla-game-card__badges {
      display: inline-flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 0.45rem;
    }
    .pbla-game-card__badge {
      display: inline-flex;
      align-items: center;
      padding: 0.35rem 0.6rem;
      border-radius: 999px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
      color: color-mix(in srgb, var(--pbla-white) 86%, transparent);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .pbla-game-card__badge--playoff {
      background: rgba(255, 209, 102, 0.12);
      border-color: rgba(255, 209, 102, 0.28);
      color: var(--pbla-accent);
    }
    .pbla-game-card__badge--note {
      color: color-mix(in srgb, var(--pbla-white) 72%, transparent);
    }
    .pbla-game-card__matchup {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.45rem;
      color: color-mix(in srgb, var(--pbla-white) 82%, transparent);
      font-size: 1rem;
      line-height: 1.45;
    }
    .pbla-game-card__team {
      font-weight: 700;
    }
    .pbla-game-card__team--winner {
      color: var(--pbla-white);
      font-weight: 900;
    }
    .pbla-game-card__vs {
      color: color-mix(in srgb, var(--pbla-white) 52%, transparent);
      font-size: 0.76rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .pbla-games-toggle {
      margin-top: 1rem;
      border: 1px solid rgba(255, 209, 102, 0.2);
      border-radius: 999px;
      background: rgba(255,255,255,0.04);
      color: var(--pbla-white);
      padding: 0.72rem 1rem;
      font: inherit;
      font-size: 0.84rem;
      font-weight: 800;
      cursor: pointer;
      transition: transform 180ms ease, background 180ms ease, border-color 180ms ease;
    }
    .pbla-games-toggle:hover,
    .pbla-games-toggle:focus-visible {
      transform: translateY(-1px);
      background: rgba(246, 140, 31, 0.12);
      border-color: rgba(246, 140, 31, 0.34);
      outline: none;
    }
    .pbla-games-empty {
      padding: 1rem;
      border-radius: 18px;
      border: 1px dashed rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.03);
      color: color-mix(in srgb, var(--pbla-white) 68%, transparent);
      line-height: 1.6;
    }
    .pbla-cta {
      padding: 1.45rem;
      text-align: center;
      background:
        linear-gradient(135deg, rgba(246, 140, 31, 0.12), rgba(255, 209, 102, 0.08)),
        rgba(9, 13, 24, 0.88);
    }
    .pbla-cta__title {
      margin: 0;
      color: var(--pbla-white);
      font-size: clamp(1.35rem, 2vw, 2rem);
      font-weight: 900;
      letter-spacing: -0.03em;
    }
    .pbla-cta__text {
      margin: 0.55rem auto 0;
      max-width: 58ch;
      color: color-mix(in srgb, var(--pbla-white) 68%, transparent);
      font-size: 0.96rem;
      line-height: 1.6;
    }
    .pbla-cta__links {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 0.8rem;
      margin-top: 1.1rem;
    }
    .pbla-cta__link {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.72rem 1rem;
      border-radius: 999px;
      border: 1px solid rgba(255, 209, 102, 0.22);
      background: rgba(255,255,255,0.04);
      color: var(--pbla-white);
      font-size: 0.86rem;
      font-weight: 800;
      text-decoration: none;
      transition: transform 180ms ease, background 180ms ease, border-color 180ms ease;
    }
    .pbla-cta__link:hover,
    .pbla-cta__link:focus-visible {
      transform: translateY(-2px);
      background: rgba(246, 140, 31, 0.12);
      border-color: rgba(246, 140, 31, 0.34);
      outline: none;
    }
    @keyframes pbla-pulse {
      0%, 100% { transform: scale(1); opacity: 0.8; }
      50% { transform: scale(1.15); opacity: 1; }
    }
    @keyframes pbla-team-swatch-pulse {
      0% { transform: scale(1); }
      45% { transform: scale(1.35); }
      100% { transform: scale(1); }
    }
    @keyframes pbla-live-pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.3); opacity: 0.7; }
    }
    @media (max-width: 1040px) {
      .pbla-hero,
      .pbla-season-summary,
      .pbla-standings-grid,
      .pbla-games-grid {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 720px) {
      .pbla-hero,
      .pbla-section,
      .pbla-cta {
        padding: 0.85rem;
      }
      .pbla-goalie-lane,
      .pbla-team-card__stats {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .pbla-hero__title {
        font-size: clamp(1.9rem, 10vw, 2.8rem);
      }
    }
    @media (max-width: 520px) {
      .pbla-season-bar {
        width: 100%;
        justify-content: center;
      }
      .pbla-season-btn {
        flex: 1 1 0;
      }
      .pbla-goalie-lane,
      .pbla-team-card__stats {
        grid-template-columns: 1fr 1fr;
      }
    }
  `;
  doc.head.appendChild(style);
}
