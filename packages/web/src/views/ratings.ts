import { getLaxNumbersRatings } from '../api.js';
import { IS_STATIC, staticFetch } from '../staticLoader.js';
import { setPageMeta } from '../util/pageMeta.js';
import { apiUrl } from '../apiBase.js';
import type { LaxNumbersRating } from '@pll/shared';

const STYLE_ID = 'ratings-view-styles';

const VIEWS = [
  { id: 3454, name: 'Inter-Ac Conference', slug: 'inter-ac' },
  { id: 3468, name: 'Private Schools Region', slug: 'private-schools' },
] as const;

let activeRoot: HTMLElement | null = null;

function ensureStyles(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .ratings-view {
      max-width: 960px;
      margin: 0 auto;
      padding: 1.5rem 1rem;
    }
    .ratings-view h1 {
      font-size: 1.75rem;
      margin-bottom: 0.25rem;
    }
    .ratings-view .subtitle {
      color: var(--text-secondary, #94a3b8);
      font-size: 0.9rem;
      margin-bottom: 1.5rem;
    }
    .ratings-view .conference-section {
      margin-bottom: 2rem;
    }
    .ratings-view .conference-section h2 {
      font-size: 1.25rem;
      margin-bottom: 0.75rem;
      border-bottom: 1px solid var(--border-color, #334155);
      padding-bottom: 0.5rem;
    }
    .ratings-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    .ratings-table th {
      text-align: left;
      padding: 0.5rem 0.4rem;
      font-weight: 600;
      color: var(--text-secondary, #94a3b8);
      border-bottom: 2px solid var(--border-color, #334155);
      white-space: nowrap;
    }
    .ratings-table td {
      padding: 0.5rem 0.4rem;
      border-bottom: 1px solid var(--border-color, #1e293b);
      vertical-align: middle;
    }
    .ratings-table tr:hover td {
      background: var(--hover-bg, rgba(78, 161, 255, 0.05));
    }
    .ratings-table .rank-cell {
      font-weight: 700;
      width: 2.5rem;
      text-align: center;
    }
    .ratings-table .team-cell {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .ratings-table .team-cell a {
      color: var(--link-color, #4ea1ff);
      text-decoration: none;
    }
    .ratings-table .team-cell a:hover {
      text-decoration: underline;
    }
    .ratings-table .team-logo {
      width: 24px;
      height: 24px;
      object-fit: contain;
      border-radius: 2px;
    }
    .ratings-table .num-cell {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .ratings-table .record-cell {
      white-space: nowrap;
    }
    .rating-badge {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-weight: 700;
      font-size: 0.8rem;
    }
    .rating-badge.elite { background: rgba(52, 211, 153, 0.15); color: #34d399; }
    .rating-badge.strong { background: rgba(78, 161, 255, 0.15); color: #4ea1ff; }
    .rating-badge.average { background: rgba(148, 163, 184, 0.1); color: #94a3b8; }
    .ratings-attribution {
      font-size: 0.75rem;
      color: var(--text-secondary, #64748b);
      margin-top: 1rem;
    }
    .ratings-attribution a { color: var(--link-color, #4ea1ff); }
    @media (max-width: 640px) {
      .ratings-table { font-size: 0.75rem; }
      .ratings-table th, .ratings-table td { padding: 0.35rem 0.25rem; }
      .hide-mobile { display: none; }
    }
  `;
  doc.head.appendChild(style);
}

function ratingBadgeClass(rating: number): string {
  if (rating >= 70) return 'elite';
  if (rating >= 50) return 'strong';
  return 'average';
}

function logoHtml(r: LaxNumbersRating): string {
  if (!r.logoUrl) return '';
  return `<img class="team-logo" src="${apiUrl(r.logoUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">`;
}

function renderTable(ratings: LaxNumbersRating[]): string {
  if (ratings.length === 0) {
    return '<p style="color:var(--text-secondary,#94a3b8)">No ratings data available for this conference.</p>';
  }
  const rows = ratings
    .map(
      (r) => `
    <tr>
      <td class="rank-cell">${r.ranking}</td>
      <td><div class="team-cell">
        ${logoHtml(r)}
        <a href="#/teams/${r.teamId}">${r.teamName}</a>
      </div></td>
      <td class="num-cell"><span class="rating-badge ${ratingBadgeClass(r.rating)}">${r.rating.toFixed(1)}</span></td>
      <td class="num-cell record-cell">${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}</td>
      <td class="num-cell hide-mobile">${r.gf}</td>
      <td class="num-cell hide-mobile">${r.ga}</td>
      <td class="num-cell hide-mobile">${r.agd > 0 ? '+' : ''}${r.agd.toFixed(1)}</td>
      <td class="num-cell hide-mobile">${r.sched.toFixed(1)}</td>
    </tr>`,
    )
    .join('');

  return `
    <table class="ratings-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Team</th>
          <th class="num-cell">Rating</th>
          <th>Record</th>
          <th class="num-cell hide-mobile">GF</th>
          <th class="num-cell hide-mobile">GA</th>
          <th class="num-cell hide-mobile">AGD</th>
          <th class="num-cell hide-mobile">SoS</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function loadRatings(viewId: number, slug: string): Promise<LaxNumbersRating[]> {
  if (IS_STATIC) {
    return staticFetch<LaxNumbersRating[]>(`/data/2026/laxnumbers-ratings-${slug}.json`);
  }
  return getLaxNumbersRatings({ year: 2026, view: viewId });
}

export async function render(container: HTMLElement): Promise<void> {
  ensureStyles();
  setPageMeta({ title: 'LaxNumbers Power Ratings', description: 'Team power ratings from LaxNumbers.com for Philadelphia-area lacrosse conferences.' });

  activeRoot = container;
  container.innerHTML = `
    <div class="ratings-view">
      <h1>Power Ratings</h1>
      <p class="subtitle">Team strength ratings from LaxNumbers.com - combines win/loss record, goal differential, and strength of schedule into a single power rating.</p>
      <div id="ratings-sections">Loading...</div>
      <p class="ratings-attribution">Data courtesy of <a href="https://laxnumbers.com" target="_blank" rel="noopener">LaxNumbers.com</a>. Ratings updated periodically during the season.</p>
    </div>
  `;

  const sectionsEl = container.querySelector('#ratings-sections')!;
  const sections: string[] = [];

  for (const view of VIEWS) {
    try {
      const ratings = await loadRatings(view.id, view.slug);
      sections.push(`
        <div class="conference-section">
          <h2>${view.name}</h2>
          ${renderTable(ratings)}
        </div>
      `);
    } catch {
      sections.push(`
        <div class="conference-section">
          <h2>${view.name}</h2>
          <p style="color:var(--text-secondary,#94a3b8)">Unable to load ratings.</p>
        </div>
      `);
    }
  }

  sectionsEl.innerHTML = sections.join('');
}

export function destroy(): void {
  activeRoot = null;
}
