import {
  ApiError,
  getTeamDetail,
  getTeams,
  getTeamTopScorers,
  type TeamDetail,
  type TopScorerEntry,
} from '../api.js';
import type { Game } from '@pll/shared';
import { formatDate, formatRecord, gameResult } from '../util/format.js';
import { renderSeasonRecord, renderTopScorers } from '../charts/index.js';
import { renderTeamBadge } from '../components/teamBadge.js';
import { renderProvenanceBadge } from '../components/provenanceBadge.js';

export function render(root: HTMLElement, params: Record<string, string>): void {
  root.replaceChildren();

  const back = document.createElement('p');
  back.className = 'muted';
  const backLink = document.createElement('a');
  backLink.href = '#/';
  backLink.textContent = '← back to dashboard';
  back.appendChild(backLink);
  root.appendChild(back);

  const id = params['id'] ?? '';
  if (!id) {
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = 'Missing team id';
    root.appendChild(p);
    return;
  }

  const status = document.createElement('p');
  status.textContent = 'Loading…';
  root.appendChild(status);

  void load(root, status, id);
}

async function load(root: HTMLElement, status: HTMLElement, id: string): Promise<void> {
  let detail: TeamDetail;
  const teamsById = new Map<number, string>();
  try {
    const [d, teams] = await Promise.all([getTeamDetail(id), getTeams()]);
    detail = d;
    for (const t of teams) teamsById.set(t.id, t.name);
  } catch (err) {
    const msg = err instanceof ApiError ? `${err.message} (${err.url})` : String(err);
    status.className = 'error';
    status.textContent = msg;
    return;
  }
  status.remove();

  const teamId = detail.team.id;

  const heading = document.createElement('h1');
  heading.className = 'team-detail-hero';
  heading.style.cssText = 'display:flex; align-items:center; gap:1rem;';
  heading.appendChild(
    renderTeamBadge({
      name: detail.team.name,
      logoUrl: detail.team.logoUrl,
      size: 'xl',
    }),
  );
  root.appendChild(heading);

  const callouts = document.createElement('div');
  callouts.className = 'callout-row';

  const piaa = detail.team.piaa ?? null;

  if (piaa) {
    const piaaCallout = document.createElement('div');
    piaaCallout.className = 'record-callout record-callout--piaa';
    const piaaLabel = document.createElement('span');
    piaaLabel.className = 'callout-label';
    piaaLabel.style.cssText = 'display:flex; align-items:center; gap:.4rem;';
    const piaaLabelText = document.createElement('span');
    piaaLabelText.textContent = 'PIAA Record';
    piaaLabel.append(piaaLabelText, renderProvenanceBadge({ source: 'piaa' }));
    const piaaValue = document.createElement('span');
    piaaValue.className = 'callout-value';
    const piaaWl = `${piaa.wins}-${piaa.losses}` + (piaa.ties > 0 ? `-${piaa.ties}` : '');
    piaaValue.textContent = piaaWl;
    piaaCallout.append(piaaLabel, piaaValue);
    if (piaa.seed !== null || piaa.classification) {
      const sub = document.createElement('span');
      sub.className = 'muted';
      sub.style.fontSize = '.85rem';
      const parts: string[] = [];
      if (piaa.seed !== null) parts.push(`Seed #${piaa.seed}`);
      if (piaa.classification) parts.push(piaa.classification);
      sub.textContent = `(${parts.join(', ')})`;
      piaaCallout.appendChild(sub);
    }
    callouts.appendChild(piaaCallout);
  }

  const recordCallout = document.createElement('div');
  recordCallout.className = 'record-callout';
  const recordLabel = document.createElement('span');
  recordLabel.className = 'callout-label';
  recordLabel.style.cssText = 'display:flex; align-items:center; gap:.4rem;';
  const recordLabelText = document.createElement('span');
  recordLabelText.textContent = piaa ? 'PhillyLacrosse coverage' : 'Record';
  recordLabel.append(recordLabelText, renderProvenanceBadge({ source: 'phillylacrosse' }));
  const recordValue = document.createElement('span');
  recordValue.className = 'callout-value';
  recordValue.textContent = formatRecord(detail.record);
  recordCallout.append(recordLabel, recordValue);
  callouts.appendChild(recordCallout);

  if (detail.recentRanking !== null) {
    const rankCallout = document.createElement('div');
    rankCallout.className = 'record-callout';
    const rankLabel = document.createElement('span');
    rankLabel.className = 'callout-label';
    rankLabel.textContent = 'Latest Ranking';
    const rankValue = document.createElement('span');
    rankValue.className = 'callout-value';
    rankValue.textContent = `#${detail.recentRanking}`;
    rankCallout.append(rankLabel, rankValue);
    callouts.appendChild(rankCallout);
  }

  root.appendChild(callouts);

  if (piaa) {
    const ourW = detail.record.wins;
    const ourL = detail.record.losses;
    const piaaDiffers = ourW !== piaa.wins || ourL !== piaa.losses;
    if (piaaDiffers) {
      const note = document.createElement('p');
      note.className = 'muted';
      note.style.cssText = 'margin:.25rem 0 1rem; font-size:.9rem;';
      note.textContent =
        'Note: PhillyLacrosse coverage may be partial; PIAA is authoritative for win/loss totals.';
      root.appendChild(note);
    }
  }

  const coverage = detail.team.coverage ?? null;
  if (coverage && coverage.piaaGames !== null && coverage.gap !== null) {
    if (coverage.gap > 0) {
      const cn = document.createElement('p');
      cn.className = 'coverage-note';
      cn.textContent =
        `PhillyLacrosse coverage: ${coverage.ourGames} of ${coverage.piaaGames}` +
        ` games tracked (${coverage.gap} missing)`;
      root.appendChild(cn);
    } else if (coverage.gap === 0) {
      const cn = document.createElement('p');
      cn.className = 'coverage-note coverage-note--complete';
      cn.textContent =
        `PhillyLacrosse coverage complete: ${coverage.ourGames} of ${coverage.piaaGames} games tracked`;
      root.appendChild(cn);
    }
  }

  const chartSlot = document.createElement('div');
  chartSlot.dataset['chart'] = 'seasonRecord';
  chartSlot.className = 'chart-slot';
  root.appendChild(chartSlot);
  if (detail.record.wins + detail.record.losses + detail.record.ties > 0) {
    renderSeasonRecord(chartSlot, detail.record);
  }

  const topScorersHeader = document.createElement('h2');
  topScorersHeader.textContent = 'Top Scorers';
  root.appendChild(topScorersHeader);

  const topScorersSlot = document.createElement('div');
  topScorersSlot.dataset['chart'] = 'topScorers';
  topScorersSlot.className = 'chart-slot';
  root.appendChild(topScorersSlot);
  void loadTopScorers(topScorersSlot, teamId);

  const gamesHeader = document.createElement('h2');
  gamesHeader.textContent = 'Season Games';
  root.appendChild(gamesHeader);

  const gamesPlayed = detail.games.filter((g) => !g.postponed);
  if (gamesPlayed.length === 0 && detail.games.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No games yet.';
    root.appendChild(empty);
    return;
  }

  root.appendChild(buildGamesTable(detail.games, teamId, teamsById));
}

async function loadTopScorers(slot: HTMLElement, teamId: number): Promise<void> {
  let scorers: TopScorerEntry[];
  try {
    scorers = await getTeamTopScorers(teamId, 5);
  } catch (err) {
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = err instanceof ApiError ? `${err.message} (${err.url})` : String(err);
    slot.replaceChildren(p);
    return;
  }
  if (scorers.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No player scoring stats yet for this team.';
    slot.replaceChildren(p);
    return;
  }
  renderTopScorers(
    slot,
    scorers.map((s) => ({ playerName: s.playerName, goals: s.goals, assists: s.assists })),
  );
}

function buildGamesTable(games: Game[], teamId: number, teamsById: Map<number, string>): HTMLElement {
  const sorted = [...games].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.id - a.id;
  });

  const table = document.createElement('table');
  table.className = 'stat season-games';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const label of ['Date', 'Opponent', 'H/A', 'Score', 'Result']) {
    const th = document.createElement('th');
    th.textContent = label;
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const g of sorted) {
    const isHome = g.homeTeamId === teamId;
    const opponentId = isHome ? g.awayTeamId : g.homeTeamId;
    const myScore = isHome ? g.homeScore : g.awayScore;
    const oppScore = isHome ? g.awayScore : g.homeScore;

    const tr = document.createElement('tr');
    tr.className = 'row-link';
    tr.tabIndex = 0;
    tr.setAttribute('role', 'link');
    const go = (): void => {
      window.location.hash = `#/games/${g.id}`;
    };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });

    const tdDate = document.createElement('td');
    tdDate.textContent = formatDate(g.date);
    tr.appendChild(tdDate);

    const tdOpp = document.createElement('td');
    const oppLink = document.createElement('a');
    oppLink.href = `#/teams/${opponentId}`;
    oppLink.textContent = teamsById.get(opponentId) ?? `Team #${opponentId}`;
    oppLink.addEventListener('click', (e) => e.stopPropagation());
    tdOpp.appendChild(oppLink);
    tr.appendChild(tdOpp);

    const tdHa = document.createElement('td');
    tdHa.textContent = isHome ? 'Home' : 'Away';
    tr.appendChild(tdHa);

    const tdScore = document.createElement('td');
    if (g.postponed) {
      tdScore.textContent = 'Postponed';
    } else {
      tdScore.textContent =
        `${myScore}–${oppScore}` +
        (g.otPeriods > 0 ? ` (OT${g.otPeriods > 1 ? `×${g.otPeriods}` : ''})` : '');
    }
    tr.appendChild(tdScore);

    const tdResult = document.createElement('td');
    if (g.postponed) {
      tdResult.textContent = '—';
    } else {
      const r = gameResult(myScore, oppScore);
      tdResult.textContent = r;
      tdResult.className = `result-${r.toLowerCase()}`;
    }
    tr.appendChild(tdResult);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}
