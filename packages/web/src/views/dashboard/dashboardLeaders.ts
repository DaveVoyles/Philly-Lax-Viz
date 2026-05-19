import {
  getPlayerLeaders,
  type PlayerLeaderMetric,
  type PlayerLeaderRow,
} from '../../api.js';
import { renderHorizontalLeaderboard } from '../../charts/index.js';
import type { ChartHandle } from '../../charts/types.js';
import { renderEmptyState } from '../../components/emptyState.js';
import { errorBlock } from './dashboardErrors.js';

const LEADER_PANEL_LIMIT = 10;

export function intFmt(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n)) : '—';
}

export function pctFmt(n: number): string {
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '—';
}

export interface LeaderPanel {
  wrap: HTMLElement;
  body: HTMLElement;
}

export function makeLeaderPanel(title: string, sub: string): LeaderPanel {
  const wrap = document.createElement('div');
  wrap.className = 'leader-panel';
  wrap.style.cssText =
    'border:1px solid var(--border); border-radius:8px; padding:.75rem 1rem; background:var(--bg-elev, transparent);';
  const h3 = document.createElement('h3');
  h3.textContent = title;
  h3.style.cssText = 'margin:0 0 .25rem; font-size:1rem;';
  wrap.appendChild(h3);
  const p = document.createElement('p');
  p.className = 'muted';
  p.style.cssText = 'margin:.1rem 0 .5rem; font-size:.85rem;';
  p.textContent = sub;
  wrap.appendChild(p);
  const body = document.createElement('div');
  body.textContent = 'Loading…';
  wrap.appendChild(body);
  return { wrap, body };
}

export async function loadLeaderPanel(
  el: HTMLElement,
  metric: PlayerLeaderMetric,
  extra: { minGames?: number; minAttempts?: number },
  format: (n: number) => string,
  axisLabel: string,
  season: string,
  dashboardCharts: ChartHandle[],
): Promise<void> {
  try {
    const resp = await getPlayerLeaders({ metric, limit: LEADER_PANEL_LIMIT, ...extra, season });
    el.replaceChildren();
    const top = resp.rows.slice(0, LEADER_PANEL_LIMIT);
    if (top.length === 0) {
      el.appendChild(renderEmptyState({ subject: 'qualifying players' }));
      return;
    }
    const handle = renderHorizontalLeaderboard(
      el,
      top.map((r: PlayerLeaderRow) => ({
        label: r.playerName,
        value: r.value,
        href: `#/players/${r.playerId}`,
        sublabel: r.teamName,
      })),
      {
        valueFormat: format,
        xAxisLabel: axisLabel,
        height: 360,
        margin: { top: 16, right: 56, bottom: 36, left: 170 },
      },
    );
    dashboardCharts.push(handle);
  } catch (err) {
    el.replaceChildren(errorBlock(err));
  }
}
